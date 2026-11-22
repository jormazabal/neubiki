using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Proton.Drive.Sdk;
using Proton.Drive.Sdk.Nodes;
using Proton.Drive.Sdk.Nodes.Move;

public static partial class Bridge
{
    static string WorkspaceName(JsonObject payload)
    {
        var name = Text(payload, "name");
        if (name.Length > 255 || name != name.Trim() || name.EndsWith('.')
            || name.Any(c => char.IsControl(c) || "\\/:*?\"<>|".Contains(c)) || ReservedWorkspaceMetadataName(name))
            throw new Failure("invalid-node-name");
        return name;
    }

    static string VerifiedName(Node node) => node.Name.TryGetValueElseError(out var name, out _)
        ? name : throw new Failure("unverified-node-name");

    static bool ReservedWorkspaceMetadataName(string name)
    {
        var portable = name.TrimEnd('.', ' ');
        return string.Equals(portable, ".neubiki-favorites.json", StringComparison.OrdinalIgnoreCase)
            || string.Equals(portable, ".neubiki-export-profiles.json", StringComparison.OrdinalIgnoreCase);
    }

    static async Task<JsonObject> WorkspaceTreeEdit(ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var action = Text(payload, "action");
        var root = NodeUid.Parse(Text(payload, "rootId"));
        var parentUid = NodeUid.Parse(Text(payload, "parentId"));
        await WorkspaceFolder(drive, parentUid, root, ct);
        if (action is "create-folder" or "create-document" or "create-note" or "import-file")
        {
            var name = WorkspaceName(payload);
            if (await Find(drive, parentUid, name, ct) is { TrashTime: null })
                throw new Failure("name-conflict");
            if (action == "create-folder")
                return NodeDto(await drive.CreateFolderAsync(parentUid, name, null, ct));
            if (action == "create-note")
            {
                if (!name.EndsWith(".nbnote", StringComparison.OrdinalIgnoreCase))
                    throw new Failure("invalid-node-name");
                var note = Convert.FromBase64String(Text(payload, "contentBase64"));
                if (note.Length > 8 * 1024 * 1024) throw new Failure("file-too-large");
                return await WorkspaceCreateFile(drive, parentUid, name, "application/vnd.neubiki.handwritten-note+json", note, ct);
            }
            if (action == "import-file")
            {
                var encoded = payload["contentBase64"]?.GetValue<string>() ?? throw new Failure("invalid-request");
                const int maxBytes = 8 * 1024 * 1024;
                if (encoded.Length > ((maxBytes + 2) / 3) * 4)
                    throw new Failure("file-too-large");
                byte[] content;
                try { content = Convert.FromBase64String(encoded); }
                catch (FormatException) { throw new Failure("invalid-request"); }
                if (content.Length > maxBytes)
                    throw new Failure("file-too-large");
                var mediaType = IsMarkdownName(name) ? "text/markdown" : Text(payload, "mediaType");
                return await WorkspaceCreateFile(drive, parentUid, name, mediaType, content, ct);
            }
            if (!IsMarkdownName(name))
                throw new Failure("not-markdown");
            return await WorkspaceCreateFile(drive, parentUid, name, "text/markdown", "\n"u8.ToArray(), ct);
        }

        var uid = NodeUid.Parse(Text(payload, "nodeId"));
        if (uid == root)
            throw new Failure("outside-workspace");
        var node = await Within(drive, uid, root, ct);
        var currentName = VerifiedName(node);
        if (ReservedWorkspaceMetadataName(currentName)) throw new Failure("invalid-node-name");
        if (node.ParentUid != parentUid || currentName != Text(payload, "expectedName"))
            throw new Failure("stale-node");

        if (action == "trash")
        {
            await foreach (var item in drive.TrashNodesAsync([uid], ct))
            {
                if (item.NodeUid != uid)
                    throw new Failure("invalid-response");
                if (item.Result.TryGetError(out var error))
                    throw error;
                return new JsonObject { ["trashedId"] = uid.ToString() };
            }
            throw new Failure("invalid-response");
        }

        if (action == "duplicate")
        {
            var name = WorkspaceName(payload);
            if (node is not FileNode file || !IsMarkdownName(currentName) || !IsMarkdownName(name))
                throw new Failure("not-markdown");
            if (await Find(drive, parentUid, name, ct) is { TrashTime: null })
                throw new Failure("name-conflict");
            var bytes = await Read(drive, file, ct, 4 * 1024 * 1024);
            await WorkspaceFolder(drive, parentUid, root, ct);
            return await WorkspaceCreateFile(drive, parentUid, name, file.MediaType ?? "text/markdown", bytes, ct);
        }

        if (action is not ("rename" or "move"))
            throw new Failure("invalid-request");
        var target = action == "move" ? NodeUid.Parse(Text(payload, "targetParentId")) : parentUid;
        var targetName = action == "rename" ? WorkspaceName(payload) : currentName;
        if (action == "rename" && node is FileNode
            && !string.Equals(FileExtension(currentName), FileExtension(targetName), StringComparison.OrdinalIgnoreCase))
            throw new Failure("file-extension-changed");
        if (target == parentUid && targetName == currentName)
            return NodeDto(node);
        if (await Within(drive, target, root, ct, uid) is not FolderNode)
            throw new Failure("not-folder");

        await foreach (var item in drive.MoveNodesAsync([new NodeMoveItem(uid, parentUid, currentName, targetName)], target, ct))
        {
            if (item.NodeUid != uid)
                throw new Failure("invalid-response");
            if (item.Result.TryGetError(out var error))
                throw error;
            var result = NodeDto(node);
            result["name"] = targetName;
            return result;
        }
        throw new Failure("invalid-response");
    }

    static string FileExtension(string name) => name.LastIndexOf('.') > 0 ? Path.GetExtension(name) : "";

    static bool IsMarkdownName(string name) => FileExtension(name).ToLowerInvariant() is ".md" or ".markdown" or ".mdown";

    static bool IsHandwrittenName(string name) => FileExtension(name).ToLowerInvariant() is ".nbnote" or ".knote";

    static async Task<JsonObject> WorkspaceCreateFile(ProtonDriveClient drive, NodeUid parent, string name,
        string mediaType, byte[] bytes, CancellationToken ct)
    {
        using var input = new MemoryStream(bytes, writable: false);
        using var uploader = await drive.GetFileUploaderAsync(parent, name, mediaType, bytes.Length, new FileUploadMetadata(), false, ct);
        await using var controller = uploader.UploadFromStream(input, [], null, () => SHA1.HashData(bytes), ct);
        var result = await controller.Completion;
        return new JsonObject
        {
            ["nodeId"] = result.NodeUid.ToString(), ["type"] = "file", ["name"] = name,
            ["revisionId"] = result.RevisionUid.ToString(), ["mediaType"] = mediaType,
        };
    }
}
