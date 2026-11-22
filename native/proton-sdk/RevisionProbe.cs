using System.Text;
using System.Text.Json.Nodes;
using Proton.Drive.Sdk;
using Proton.Drive.Sdk.Nodes;
using Proton.Drive.Sdk.Nodes.Upload;
using Proton.Sdk.Api;

public static partial class Bridge
{
    const string ProbeFolderPrefix = "Neubiki 0.6 QA ";
    const string ProbeFilePrefix = "CAS-";

    static async Task<FolderNode> SyntheticProbeFolder(
        ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var rootUid = NodeUid.Parse(Text(payload, "rootId"));
        var folder = await WorkspaceFolder(drive, rootUid, null, ct);
        if (payload["authorizeSyntheticFixture"]?.GetValue<bool>() != true
            || !Text(NodeDto(folder), "name").StartsWith(ProbeFolderPrefix, StringComparison.Ordinal))
            throw new Failure("synthetic-fixture-required");
        return folder;
    }

    static async Task<FileNode> ProbeFile(
        ProtonDriveClient drive, FolderNode folder, string nodeId, string expectedName, CancellationToken ct)
    {
        var uid = NodeUid.Parse(nodeId);
        var file = await GetVisibleNode(drive, uid, ct) as FileNode
            ?? throw new Failure("synthetic-fixture-required");
        if (file.ParentUid != folder.Uid || Text(NodeDto(file), "name") != expectedName)
            throw new Failure("synthetic-fixture-required");

        var seed = await Read(drive, file, ct);
        if (!seed.AsSpan().SequenceEqual("# Neubiki CAS synthetic fixture\n"u8))
            throw new Failure("synthetic-fixture-required");
        return file;
    }
    static async Task<JsonObject> RevisionProbe(
        ProtonDriveClient drive, ProtonDriveClient competitor, JsonObject payload, CancellationToken ct)
    {
        var small = Encoding.UTF8.GetBytes("# Short revision\n");
        var large = Encoding.UTF8.GetBytes("# Large revision\n" + new string('A', 256 * 1024));
        var losing = Encoding.UTF8.GetBytes("# Competing revision\n");
        var stage = "validate-folder";

        try
        {
            var folder = await SyntheticProbeFolder(drive, payload, ct);
            stage = "read-short-seed";
            var shortFile = await ProbeFile(drive, folder, Text(payload, "shortNodeId"), "CAS-short.md", ct);
            stage = "read-large-seed";
            var largeFile = await ProbeFile(drive, folder, Text(payload, "largeNodeId"), "CAS-large.md", ct);
            var shortResult = await VerifyStaleBase("short", shortFile, small);
            var largeResult = await VerifyStaleBase("large", largeFile, large);
            stage = "overlapping-revisions";
            var concurrentResult = await VerifyOverlap(largeFile.Uid);
            stage = "read-loss-fixture";
            var active = (FileNode)await GetVisibleNode(competitor, shortFile.Uid, ct);
            return new JsonObject
            {
                ["short"] = shortResult,
                ["large"] = largeResult,
                ["overlap"] = concurrentResult,
                ["lossFixture"] = NodeDto(active),
            };
        }
        catch (Failure error)
        {
            return Failed(error.Code);
        }
        catch (RevisionDraftConflictException)
        {
            return Failed("revision-conflict");
        }
        catch (ProtonApiException error)
        {
            return Failed($"provider-{error.TransportCode}-{error.Code}");
        }
        catch (HttpRequestException)
        {
            return Failed("network");
        }
        catch (OperationCanceledException)
        {
            return Failed("timeout");
        }

        JsonObject Failed(string code) => new() { ["stage"] = stage, ["probeError"] = code };

        async Task<JsonObject> VerifyStaleBase(string size, FileNode file, byte[] bytes)
        {
            stage = $"{size}-publish-revision";
            using var first = new MemoryStream(bytes, writable: false);
            var committed = await UploadRevision(drive, file.ActiveRevision.Uid, first, bytes, ct);
            stage = $"{size}-stale-base";
            using var second = new MemoryStream(losing, writable: false);
            var stale = await ProbeUpload(competitor, file.ActiveRevision.Uid, second, losing, ct);
            stage = $"{size}-read-winner";
            var current = (FileNode)await GetVisibleNode(competitor, file.Uid, ct);
            var observed = await Read(competitor, current, ct);
            return new JsonObject
            {
                ["staleOutcome"] = stale.Outcome,
                ["sameNode"] = committed.NodeUid == file.Uid,
                ["winnerPreserved"] = current.ActiveRevision.Uid == committed.RevisionUid
                    && observed.AsSpan().SequenceEqual(bytes),
            };
        }

        async Task<JsonObject> VerifyOverlap(NodeUid uid)
        {
            var file = (FileNode)await GetVisibleNode(drive, uid, ct);
            var staged = Encoding.UTF8.GetBytes("# First staged revision\n" + new string('B', 256 * 1024));
            using var first = new PausedRead(staged);
            var uploading = ProbeUpload(drive, file.ActiveRevision.Uid, first, staged, ct);
            if (await Task.WhenAny(first.Started, uploading) == uploading)
                throw new Failure("probe-could-not-pause-draft");
            await first.Started.WaitAsync(ct);

            (string Outcome, UploadResult? Ack) competing;
            try
            {
                using var second = new MemoryStream(losing, writable: false);
                competing = await ProbeUpload(competitor, file.ActiveRevision.Uid, second, losing, ct);
            }
            finally
            {
                first.Continue();
            }

            var initial = await uploading;
            var current = (FileNode)await GetVisibleNode(competitor, uid, ct);
            var observed = await Read(competitor, current, ct);
            var firstWon = initial.Ack is { } firstAck
                && firstAck.RevisionUid == current.ActiveRevision.Uid
                && firstAck.RevisionUid != file.ActiveRevision.Uid
                && competing.Outcome == "conflict" && observed.AsSpan().SequenceEqual(staged);
            var secondWon = competing.Ack is { } secondAck
                && secondAck.RevisionUid == current.ActiveRevision.Uid
                && secondAck.RevisionUid != file.ActiveRevision.Uid
                && initial.Outcome == "conflict" && observed.AsSpan().SequenceEqual(losing);
            return new JsonObject
            {
                ["firstDraft"] = initial.Outcome,
                ["competingDraft"] = competing.Outcome,
                ["oneWinnerPreserved"] = firstWon || secondWon,
            };
        }
    }

    static async Task<(string Outcome, UploadResult? Ack)> ProbeUpload(
        ProtonDriveClient drive, RevisionUid revision, Stream stream, byte[] data, CancellationToken ct)
    {
        try
        {
            return ("saved", await UploadRevision(drive, revision, stream, data, ct));
        }
        catch (RevisionDraftConflictException)
        {
            return ("conflict", null);
        }
        catch (ProtonApiException error) when (IsRevisionConflict(error))
        {
            return ("conflict", null);
        }
        catch (ProtonApiException error)
        {
            return ($"provider-{error.TransportCode}-{error.Code}", null);
        }
    }

    static bool IsRevisionConflict(ProtonApiException error) =>
        error.TransportCode == 409 || error.Code is 2500 or 2511;

    static async Task<JsonObject> DropRevisionReply(
        ProtonDriveClient drive, JsonObject payload, CancellationToken ct)
    {
        var folder = await SyntheticProbeFolder(drive, payload, ct);
        var file = await WorkspaceFile(drive, payload, ct);
        if (file.ParentUid != folder.Uid
            || !Text(NodeDto(file), "name").StartsWith(ProbeFilePrefix, StringComparison.Ordinal))
            throw new Failure("synthetic-fixture-required");

        await WriteWorkspaceRevision(drive, payload, ct);
        throw new Failure("synthetic-reply-lost", true);
    }

    sealed class PausedRead(byte[] content) : MemoryStream(content, writable: false)
    {
        readonly TaskCompletionSource _started = new(TaskCreationOptions.RunContinuationsAsynchronously);
        readonly TaskCompletionSource _continue = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task Started => _started.Task;
        public void Continue() => _continue.TrySetResult();

        // The regular SDK creates the revision draft before reading the input.
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            _started.TrySetResult();
            await _continue.Task.WaitAsync(ct);
            return await base.ReadAsync(buffer, ct);
        }
    }
}
