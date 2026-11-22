using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Proton.Drive.Sdk;
using Proton.Drive.Sdk.Nodes;
using Proton.Drive.Sdk.Nodes.Upload;
using Proton.Sdk.Configuration;

public static partial class Bridge
{
    // The 0.6 save contract is verified only against regular revision uploads.
    sealed class RegularRevisionUploads(IFeatureFlagProvider upstream) : IFeatureFlagProvider
    {
        public Task<bool> IsEnabledAsync(string flagName, CancellationToken ct) =>
            flagName == FeatureFlags.DriveSmallFileUpload
                ? Task.FromResult(false)
                : upstream.IsEnabledAsync(flagName, ct);
    }

    static async Task<Node> GetVisibleNode(ProtonDriveClient drive, NodeUid uid, CancellationToken ct)
    {
        var node = await drive.GetNodeAsync(uid, ct);
        if (node == null || node.TrashTime != null)
            throw new Failure("not-found");
        return node;
    }

    static async Task<Node> Within(
        ProtonDriveClient drive, NodeUid nodeUid, NodeUid rootUid, CancellationToken ct)
    {
        var node = await GetVisibleNode(drive, nodeUid, ct);
        var ancestor = node;
        for (var depth = 0; depth < 128; depth++)
        {
            if (ancestor.Uid == rootUid)
            {
                if (ancestor is not FolderNode)
                    throw new Failure("not-folder");
                return node;
            }

            if (ancestor.ParentUid is not { } parentUid)
                break;
            ancestor = await GetVisibleNode(drive, parentUid, ct);
            if (ancestor is not FolderNode)
                break;
        }

        throw new Failure("outside-workspace");
    }

    static async Task<FolderNode> WorkspaceFolder(
        ProtonDriveClient drive, NodeUid uid, NodeUid? rootUid, CancellationToken ct)
    {
        var scope = rootUid ?? (await drive.GetMyFilesFolderAsync(ct)).Uid;
        return await Within(drive, uid, scope, ct) as FolderNode
            ?? throw new Failure("not-folder");
    }

    static async Task<JsonObject> WorkspaceList(
        ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var parentUid = NodeUid.Parse(Text(payload, "parentId"));
        var scope = payload["rootId"]?.GetValue<string>();
        var folder = await WorkspaceFolder(
            drive, parentUid, scope == null ? null : NodeUid.Parse(scope), ct);
        var items = new JsonArray();
        await foreach (var uid in drive.EnumerateFolderChildrenNodeUidsAsync(folder.Uid, ct))
        {
            if (items.Count >= 10000)
                throw new Failure("inventory-limit");
            var node = await drive.GetNodeAsync(uid, ct) ?? throw new Failure("incomplete-inventory");
            if (node.TrashTime == null && node.ParentUid == folder.Uid)
                items.Add((JsonNode)NodeDto(node));
        }

        return new JsonObject { ["items"] = items, ["complete"] = true };
    }

    static async Task<FileNode> WorkspaceFile(
        ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var node = await Within(
            drive, NodeUid.Parse(Text(payload, "nodeId")), NodeUid.Parse(Text(payload, "rootId")), ct);
        return node as FileNode ?? throw new Failure("not-file");
    }

    static async Task<JsonObject> WorkspaceAsset(
        ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var rootUid = NodeUid.Parse(Text(payload, "rootId"));
        var source = await WorkspaceFile(drive, payload, ct);
        if (source.ParentUid is not { } parentUid)
            throw new Failure("invalid-asset-path");
        var folder = await WorkspaceFolder(drive, parentUid, rootUid, ct);
        var parts = Text(payload, "relativePath").Split('/');
        if (parts.Length > 128 || parts.Any(part =>
            part.Length is 0 or > 255 || part.Contains('\\') || part.Contains(':') || part.Any(char.IsControl)))
            throw new Failure("invalid-asset-path");

        for (var i = 0; i < parts.Length - 1; i++)
        {
            var part = parts[i];
            if (part == ".")
                continue;
            if (part == "..")
            {
                if (folder.Uid == rootUid || folder.ParentUid is not { } ancestorUid)
                    throw new Failure("outside-workspace");
                folder = await WorkspaceFolder(drive, ancestorUid, rootUid, ct);
            }
            else
            {
                folder = await Find(drive, folder.Uid, part, ct) as FolderNode
                    ?? throw new Failure("not-found");
                if (folder.TrashTime != null)
                    throw new Failure("not-found");
            }
        }

        if (parts[^1] is "." or "..")
            throw new Failure("invalid-asset-path");
        var file = await Find(drive, folder.Uid, parts[^1], ct) as FileNode
            ?? throw new Failure("not-found");
        file = (FileNode)await Within(drive, file.Uid, rootUid, ct);
        return await ReadFileJson(drive, file, ct, 8 * 1024 * 1024);
    }

    static async Task<JsonObject> ReadFileJson(
        ProtonDriveClient drive, FileNode file, CancellationToken ct, int limit = MaxContent) =>
        new()
        {
            ["node"] = NodeDto(file),
            ["revisionId"] = file.ActiveRevision.Uid.ToString(),
            ["contentBase64"] = Convert.ToBase64String(await Read(drive, file, ct, limit)),
        };

    static async Task<FileNode> WorkspaceMarkdown(
        ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var file = await WorkspaceFile(drive, payload, ct);
        var name = (string?)NodeDto(file)["name"] ?? throw new Failure("unverified-node-name");
        var extension = Path.GetExtension(name);
        if (!extension.Equals(".md", StringComparison.OrdinalIgnoreCase)
            && !extension.Equals(".markdown", StringComparison.OrdinalIgnoreCase))
            throw new Failure("not-markdown");
        return file;
    }

    static async Task<JsonObject> WorkspaceUploadImage(
        ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        const int limit = 8 * 1024 * 1024;
        var encoded = Text(payload, "contentBase64");
        if (encoded.Length > (limit + 2L) / 3 * 4)
            throw new Failure("file-too-large");
        var content = Convert.FromBase64String(encoded);
        if (content.Length == 0 || content.Length > limit)
            throw new Failure("file-too-large");

        var mediaType = Text(payload, "mediaType");
        var extension = mediaType switch
        {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            _ => throw new Failure("invalid-asset-path"),
        };
        var digest = SHA256.HashData(content);
        var name = $"neubiki-{Convert.ToHexString(digest).ToLowerInvariant()}.{extension}";
        var root = NodeUid.Parse(Text(payload, "rootId"));
        var source = await WorkspaceMarkdown(drive, payload, ct);
        if (source.ParentUid is not { } parentUid)
            throw new Failure("invalid-asset-path");
        var parent = await WorkspaceFolder(drive, parentUid, root, ct);

        var found = await Find(drive, parent.Uid, "assets", ct);
        var folder = found switch
        {
            null => await drive.CreateFolderAsync(parent.Uid, "assets", null, ct),
            FolderNode existing when existing.TrashTime == null => existing,
            _ => throw new Failure("name-conflict"),
        };
        await WorkspaceFolder(drive, folder.Uid, root, ct);
        var current = await WorkspaceMarkdown(drive, payload, ct);
        if (current.ParentUid != parent.Uid)
            throw new Failure("invalid-asset-path");

        var previous = await Find(drive, folder.Uid, name, ct);
        if (previous != null)
        {
            if (previous is not FileNode prior || prior.TrashTime != null
                || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(await Read(drive, prior, ct, limit)), digest))
                throw new Failure("content-conflict");
        }
        else
        {
            using var input = new MemoryStream(content, writable: false);
            using var uploader = await drive.GetFileUploaderAsync(
                folder.Uid, name, mediaType, content.Length, new FileUploadMetadata(), false, ct);
            await using var controller = uploader.UploadFromStream(input, [], null, () => SHA1.HashData(content), ct);
            await controller.Completion;
        }

        current = await WorkspaceMarkdown(drive, payload, ct);
        var currentFolder = await WorkspaceFolder(drive, folder.Uid, root, ct);
        if (current.ParentUid != parent.Uid || currentFolder.ParentUid != parent.Uid
            || (string?)NodeDto(currentFolder)["name"] != "assets")
            throw new Failure("invalid-asset-path");
        return new JsonObject { ["relativePath"] = $"assets/{name}" };
    }

    static async Task<JsonObject> WriteWorkspaceRevision(
        ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var file = await WorkspaceMarkdown(drive, payload, ct);
        var baseRevision = file.ActiveRevision.Uid;
        if (baseRevision.ToString() != Text(payload, "baseRevisionId"))
            throw new Failure("revision-conflict");

        var encoded = payload["contentBase64"]?.GetValue<string>() ?? throw new Failure("invalid-request");
        if (encoded.Length > MaxContent * 4L / 3 + 4)
            throw new Failure("file-too-large");
        var content = Convert.FromBase64String(encoded);
        if (content.Length > MaxContent)
            throw new Failure("file-too-large");

        using var input = new MemoryStream(content, writable: false);
        var uploaded = await UploadRevision(drive, baseRevision, input, content, ct);
        if (uploaded.NodeUid != file.Uid || uploaded.RevisionUid == baseRevision)
            throw new Failure("unverified-revision");
        return new JsonObject
        {
            ["nodeId"] = uploaded.NodeUid.ToString(),
            ["revisionId"] = uploaded.RevisionUid.ToString(),
        };
    }

    static async Task<UploadResult> UploadRevision(
        ProtonDriveClient drive, RevisionUid baseRevision, Stream input, byte[] content, CancellationToken ct)
    {
        using var uploader = await drive.GetFileRevisionUploaderAsync(
            baseRevision, content.Length, new FileUploadMetadata(), ct);
        await using var controller = uploader.UploadFromStream(input, [], null, () => SHA1.HashData(content), ct);
        return await controller.Completion;
    }
}
