using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Proton.Drive.Sdk;
using Proton.Drive.Sdk.Nodes;

public static partial class Bridge
{
    const string FavoritesName = ".neubiki-favorites.json";
    const int FavoritesLimit = 64 * 1024;

    static bool IsFavoritesName(string name) => string.Equals(name.TrimEnd('.', ' '), FavoritesName, StringComparison.OrdinalIgnoreCase);

    static async Task<FileNode?> FavoritesFile(ProtonDriveClient drive, NodeUid root, CancellationToken ct)
    {
        await WorkspaceFolder(drive, root, root, ct);
        FileNode? found = null;
        var inspected = 0;
        await foreach (var uid in drive.EnumerateFolderChildrenNodeUidsAsync(root, ct))
        {
            if (++inspected > 10000) throw new Failure("inventory-limit");
            var node = await drive.GetNodeAsync(uid, ct) ?? throw new Failure("incomplete-inventory");
            if (node.TrashTime != null || node.ParentUid != root || !IsFavoritesName(VerifiedName(node))) continue;
            if (found != null || node is not FileNode file || VerifiedName(node) != FavoritesName)
                throw new Failure("favorites-name-conflict");
            found = file;
        }
        return found;
    }

    static JsonObject FavoritesDocument(byte[] bytes, NodeUid root)
    {
        JsonObject document;
        try { document = JsonNode.Parse(bytes)?.AsObject() ?? throw new Failure("favorites-invalid-metadata"); }
        catch (Exception error) when (error is not Failure) { throw new Failure("favorites-invalid-metadata"); }
        if (document.Count != 7 || document["schemaVersion"]?.GetValue<int>() != 1
            || document["owner"]?.GetValue<string>() != "neubiki" || document["kind"]?.GetValue<string>() != "favorites"
            || document["rootId"]?.GetValue<string>() != root.ToString()
            || document["operationId"]?.GetValue<string>() is not { Length: > 0 and <= 100 }
            || !DateTimeOffset.TryParse(document["updatedAt"]?.GetValue<string>(), out _)
            || document["items"] is not JsonArray items || items.Count > 200)
            throw new Failure("favorites-invalid-metadata");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            if (item?.GetValue<string>() is not { Length: > 0 and <= 512 } id || !seen.Add(id) || id == root.ToString())
                throw new Failure("favorites-invalid-metadata");
            try { _ = NodeUid.Parse(id); } catch { throw new Failure("favorites-invalid-metadata"); }
        }
        return document;
    }

    static JsonObject FavoritesSnapshot(FileNode? file, JsonObject? document) => new()
    {
        ["nodeId"] = file?.Uid.ToString(), ["revisionId"] = file?.ActiveRevision.Uid.ToString(),
        ["items"] = document?["items"]?.DeepClone() ?? new JsonArray(),
        ["operationId"] = document?["operationId"]?.DeepClone(),
        ["updatedAt"] = document?["updatedAt"]?.DeepClone(),
    };

    static async Task<JsonObject> WorkspaceFavoritesRead(ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var root = NodeUid.Parse(Text(payload, "rootId"));
        var file = await FavoritesFile(drive, root, ct);
        return FavoritesSnapshot(file, file == null ? null : FavoritesDocument(await Read(drive, file, ct, FavoritesLimit), root));
    }

    static async Task<JsonObject> WorkspaceFavoritesWrite(ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var root = NodeUid.Parse(Text(payload, "rootId"));
        var encoded = Text(payload, "contentBase64");
        if (encoded.Length > ((FavoritesLimit + 2) / 3) * 4) throw new Failure("file-too-large");
        var content = Convert.FromBase64String(encoded);
        if (content.Length > FavoritesLimit) throw new Failure("file-too-large");
        var proposed = FavoritesDocument(content, root);
        var file = await FavoritesFile(drive, root, ct);
        var expectedNode = payload["metadataNodeId"]?.GetValue<string>();
        var expectedRevision = payload["baseRevisionId"]?.GetValue<string>();
        if (file == null ? expectedNode != null || expectedRevision != null
            : file.Uid.ToString() != expectedNode || file.ActiveRevision.Uid.ToString() != expectedRevision)
            throw new Failure("revision-conflict");
        var previous = file == null ? null : FavoritesDocument(await Read(drive, file, ct, FavoritesLimit), root);
        var previousIds = previous?["items"]?.AsArray().Select(item => item!.GetValue<string>()).ToHashSet(StringComparer.Ordinal) ?? [];
        // Scope every proposed identity. Missing existing entries can be removed, never silently pruned.
        try
        {
            foreach (var value in proposed["items"]!.AsArray())
            {
                var id = value!.GetValue<string>();
                if (previousIds.Contains(id)) continue;
                var node = await Within(drive, NodeUid.Parse(id), root, ct);
                if (node is not FileNode || IsFavoritesName(VerifiedName(node))) throw new Failure("favorites-invalid-metadata");
            }
        }
        catch (Exception) { throw new Failure("favorites-target-unavailable"); } // No uploader has been created yet.
        JsonObject written;
        if (file == null)
        {
            try { written = await WorkspaceCreateFile(drive, root, FavoritesName, "application/vnd.neubiki.favorites+json", content, ct); }
            catch (NodeWithSameNameExistsException) { throw new Failure("revision-conflict"); }
        }
        else
        {
            using var input = new MemoryStream(content, writable: false);
            Proton.Drive.Sdk.Nodes.Upload.UploadResult uploaded;
            try { uploaded = await UploadRevision(drive, file.ActiveRevision.Uid, input, content, ct); }
            catch (NodeOutOfSyncException) { throw new Failure("revision-conflict"); }
            if (uploaded.NodeUid != file.Uid || uploaded.RevisionUid == file.ActiveRevision.Uid) throw new Failure("invalid-response");
            written = new JsonObject { ["nodeId"] = uploaded.NodeUid.ToString(), ["revisionId"] = uploaded.RevisionUid.ToString() };
        }
        var current = await FavoritesFile(drive, root, ct) ?? throw new Failure("operation-needs-review");
        if (current.Uid.ToString() != written["nodeId"]?.GetValue<string>() || current.ActiveRevision.Uid.ToString() != written["revisionId"]?.GetValue<string>())
            throw new Failure("operation-needs-review");
        var checkedBytes = await Read(drive, current, ct, FavoritesLimit);
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(content), SHA256.HashData(checkedBytes)))
            throw new Failure("operation-needs-review");
        return FavoritesSnapshot(current, FavoritesDocument(checkedBytes, root));
    }
}
