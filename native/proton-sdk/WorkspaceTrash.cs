using System.Globalization;
using System.Text.Json.Nodes;
using Proton.Drive.Sdk;
using Proton.Drive.Sdk.Nodes;

public static partial class Bridge
{
    static string TrashStamp(DateTime value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    static async Task<string[]?> WorkspaceTrashPath(
        ProtonDriveClient drive, NodeUid parentUid, FolderNode root, CancellationToken ct,
        Dictionary<NodeUid, Node?>? cache = null)
    {
        var path = new List<string>();
        for (var depth = 0; depth < 128; depth++)
        {
            if (parentUid == root.Uid)
            {
                path.Add(VerifiedName(root));
                path.Reverse();
                return path.ToArray();
            }
            if (cache == null || !cache.TryGetValue(parentUid, out var node))
            {
                node = await drive.GetNodeAsync(parentUid, ct);
                if (cache != null && cache.Count < 4_096)
                    cache[parentUid] = node;
            }
            if (node is not FolderNode { TrashTime: null, ParentUid: { } next })
                return null;
            path.Add(VerifiedName(node));
            parentUid = next;
        }
        return null;
    }

    static async Task<JsonObject> WorkspaceTrashList(ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var root = await WorkspaceFolder(drive, NodeUid.Parse(Text(payload, "rootId")), null, ct);
        var items = new JsonArray();
        var parents = new Dictionary<NodeUid, Node?>();
        var complete = true;
        var seen = new HashSet<NodeUid>();
        await foreach (var uid in drive.EnumerateTrashNodeUidsAsync(ct))
        {
            if (!seen.Add(uid)) continue;
            if (seen.Count > 1_000 || items.Count >= 200)
            {
                complete = false;
                break;
            }
            if (uid == root.Uid) continue;
            var node = await drive.GetNodeAsync(uid, ct);
            if (node == null)
            {
                complete = false;
                continue;
            }
            if (node.TrashTime is not { } trashedAt || node.ParentUid is not { } parentUid)
                continue;
            var path = await WorkspaceTrashPath(drive, parentUid, root, ct, parents);
            if (path == null) continue;
            items.Add((JsonNode)new JsonObject
            {
                ["node"] = NodeDto(node),
                ["parentId"] = parentUid.ToString(),
                ["destination"] = new JsonArray(path.Select(part => (JsonNode?)JsonValue.Create(part)).ToArray()),
                ["trashedAt"] = TrashStamp(trashedAt),
            });
        }
        return new JsonObject { ["items"] = items, ["complete"] = complete };
    }

    static async Task<JsonObject> WorkspaceTrashRestore(ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var root = await WorkspaceFolder(drive, NodeUid.Parse(Text(payload, "rootId")), null, ct);
        var uid = NodeUid.Parse(Text(payload, "nodeId"));
        var parentUid = NodeUid.Parse(Text(payload, "parentId"));
        var name = Text(payload, "expectedName");
        if (uid == root.Uid)
            throw new Failure("outside-workspace");
        var node = await drive.GetNodeAsync(uid, ct);
        if (node == null || node.TrashTime is not { } trashedAt || node.ParentUid != parentUid
            || VerifiedName(node) != name || TrashStamp(trashedAt) != Text(payload, "trashedAt"))
            throw new Failure("stale-node");
        if (await WorkspaceTrashPath(drive, parentUid, root, ct) == null)
            throw new Failure("outside-workspace");
        if (await Find(drive, parentUid, name, ct) is { TrashTime: null })
            throw new Failure("name-conflict");

        // The SDK's restore operation takes only a UID and targets the original
        // parent. The caller checks the actual parent and name in a fresh call.
        await foreach (var item in drive.RestoreNodesAsync([uid], ct))
        {
            if (item.NodeUid != uid)
                throw new Failure("invalid-response");
            if (item.Result.TryGetError(out var error))
                throw error;
            return new JsonObject { ["nodeId"] = uid.ToString() };
        }
        throw new Failure("invalid-response");
    }

    static async Task<JsonObject> WorkspaceTrashCheck(ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var root = await WorkspaceFolder(drive, NodeUid.Parse(Text(payload, "rootId")), null, ct);
        var uid = NodeUid.Parse(Text(payload, "nodeId"));
        var parentUid = NodeUid.Parse(Text(payload, "parentId"));
        if (uid == root.Uid || await WorkspaceTrashPath(drive, parentUid, root, ct) == null)
            return new JsonObject { ["node"] = null };
        var node = await drive.GetNodeAsync(uid, ct);
        if (node is not { TrashTime: null } || node.ParentUid != parentUid
            || VerifiedName(node) != Text(payload, "expectedName"))
            return new JsonObject { ["node"] = null };
        return new JsonObject { ["node"] = NodeDto(node) };
    }
}
