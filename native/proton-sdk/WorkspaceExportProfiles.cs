using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Proton.Drive.Sdk;
using Proton.Drive.Sdk.Nodes;

public static partial class Bridge
{
    const string ExportProfilesName = ".neubiki-export-profiles.json";
    const int SharedProfilesLimit = 1024 * 1024;

    static async Task<FileNode?> SharedProfilesFile(ProtonDriveClient drive, NodeUid root, CancellationToken ct)
    {
        await WorkspaceFolder(drive, root, root, ct);
        FileNode? found = null;
        var inspected = 0;
        await foreach (var uid in drive.EnumerateFolderChildrenNodeUidsAsync(root, ct))
        {
            if (++inspected > 10000) throw new Failure("inventory-limit");
            var node = await drive.GetNodeAsync(uid, ct) ?? throw new Failure("incomplete-inventory");
            if (node.TrashTime != null || node.ParentUid != root
                || !string.Equals(VerifiedName(node).TrimEnd('.', ' '), ExportProfilesName, StringComparison.OrdinalIgnoreCase)) continue;
            if (found != null || node is not FileNode file || VerifiedName(node) != ExportProfilesName)
                throw new Failure("profiles-name-conflict");
            found = file;
        }
        return found;
    }

    static JsonObject SharedProfilesDocument(byte[] bytes, NodeUid root)
    {
        JsonObject document;
        try
        {
            document = JsonNode.Parse(bytes)?.AsObject() ?? throw new Failure("profiles-invalid-metadata");
            if (document.Count != 7 || document["schemaVersion"]?.GetValue<int>() != 1
                || document["owner"]?.GetValue<string>() != "neubiki" || document["kind"]?.GetValue<string>() != "export-profiles"
                || document["rootId"]?.GetValue<string>() != root.ToString()
                || document["operationId"]?.GetValue<string>() is not { Length: > 0 and <= 100 }
                || !DateTimeOffset.TryParse(document["updatedAt"]?.GetValue<string>(), out _)
                || document["profiles"] is not JsonArray profiles || profiles.Count > 32)
                throw new Failure("profiles-invalid-metadata");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in profiles)
            {
                if (entry is not JsonObject profile || profile.Count != 5
                    || profile["id"]?.GetValue<string>() is not { Length: > 15 and <= 100 } id || !id.StartsWith("export-profile-", StringComparison.Ordinal) || !ids.Add(id)
                    || profile["name"]?.GetValue<string>() is not { Length: > 0 and <= 200 }
                    || profile["style"] is not JsonObject || profile["cover"] is not JsonValue cover || !cover.TryGetValue<bool>(out _)
                    || profile["contents"] is not JsonValue contents || !contents.TryGetValue<bool>(out _))
                    throw new Failure("profiles-invalid-metadata");
            }
            return document;
        }
        catch (Exception error) when (error is not Failure) { throw new Failure("profiles-invalid-metadata"); }
    }

    static JsonObject SharedProfilesSnapshot(FileNode? file, JsonObject? document) => new()
    {
        ["nodeId"] = file?.Uid.ToString(), ["revisionId"] = file?.ActiveRevision.Uid.ToString(),
        ["profiles"] = document?["profiles"]?.DeepClone() ?? new JsonArray(),
        ["operationId"] = document?["operationId"]?.DeepClone(), ["updatedAt"] = document?["updatedAt"]?.DeepClone(),
    };

    static async Task<JsonObject> WorkspaceProfilesRead(ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var root = NodeUid.Parse(Text(payload, "rootId"));
        var file = await SharedProfilesFile(drive, root, ct);
        return SharedProfilesSnapshot(file, file == null ? null : SharedProfilesDocument(await Read(drive, file, ct, SharedProfilesLimit), root));
    }

    static async Task<JsonObject> WorkspaceProfilesWrite(ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var root = NodeUid.Parse(Text(payload, "rootId"));
        var encoded = Text(payload, "contentBase64");
        if (encoded.Length > ((SharedProfilesLimit + 2) / 3) * 4) throw new Failure("file-too-large");
        var content = Convert.FromBase64String(encoded);
        if (content.Length > SharedProfilesLimit) throw new Failure("file-too-large");
        _ = SharedProfilesDocument(content, root);
        var file = await SharedProfilesFile(drive, root, ct);
        var expectedNode = payload["metadataNodeId"]?.GetValue<string>();
        var expectedRevision = payload["baseRevisionId"]?.GetValue<string>();
        if (file == null ? expectedNode != null || expectedRevision != null
            : file.Uid.ToString() != expectedNode || file.ActiveRevision.Uid.ToString() != expectedRevision)
            throw new Failure("revision-conflict");
        if (file != null) _ = SharedProfilesDocument(await Read(drive, file, ct, SharedProfilesLimit), root);
        JsonObject written;
        if (file == null)
        {
            try { written = await WorkspaceCreateFile(drive, root, ExportProfilesName, "application/vnd.neubiki.export-profiles+json", content, ct); }
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
        var current = await SharedProfilesFile(drive, root, ct) ?? throw new Failure("operation-needs-review");
        if (current.Uid.ToString() != written["nodeId"]?.GetValue<string>() || current.ActiveRevision.Uid.ToString() != written["revisionId"]?.GetValue<string>())
            throw new Failure("operation-needs-review");
        var observed = await Read(drive, current, ct, SharedProfilesLimit);
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(content), SHA256.HashData(observed))) throw new Failure("operation-needs-review");
        return SharedProfilesSnapshot(current, SharedProfilesDocument(observed, root));
    }
}
