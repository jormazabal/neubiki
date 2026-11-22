using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Proton.Drive.Sdk;
using Proton.Drive.Sdk.Account;
using Proton.Drive.Sdk.Account.Authentication;
using Proton.Drive.Sdk.Account.Users;
using Proton.Drive.Sdk.Nodes;
using Proton.Drive.Sdk.Events;

public static partial class Bridge {
    static JsonObject NodeDto(Node n){
        if(!n.Name.TryGetValueElseError(out var name,out _))throw new Failure("unverified-node-name");
        var value = new JsonObject
        {
            ["id"] = n.Uid.ToString(), ["nodeId"] = n.Uid.ToString(),
            ["name"] = name, ["type"] = n is FileNode ? "file" : "folder",
        };
        if (n is FileNode file)
        {
            value["revisionId"] = file.ActiveRevision.Uid.ToString();
            value["mediaType"] = file.MediaType;
        }
        return value;
    }
    static async Task<JsonObject> Drive(string op,JsonObject p,JsonObject s){
        var scopes=s["scopes"]?.AsArray().Select(x=>x?.GetValue<string>()??"").ToArray()??[];
        var api=ProtonApiSession.Resume((SessionId)Text(s,"uid"),Text(s,"username"),(UserId)Text(s,"userId"),Text(s,"accessToken"),Text(s,"refreshToken"),scopes,false,(PasswordMode)0,new Uri(Api),App);
        api.TokenCredential.TokensRefreshed += (access, refresh) =>
        {
            lock (s)
            {
                s["accessToken"] = access;
                s["refreshToken"] = refresh;
            }
        };
        await api.SetAccountKeyPassphraseAsync(Text(s,"keyId"),Encoding.UTF8.GetBytes(Text(s,"keyPassword")),CancellationToken.None);
        var c=api.ClientConfiguration;
        var http = api.CreateHttpClientFactory();
        var account = new ProtonAccountClient(http,c.CacheRepository,api.SessionSecretCache,c.Telemetry);
        var flags = op is "drive.writeRevision" or "drive.workspaceFavoritesWrite" or "drive.workspaceProfilesWrite" or "diagnostics.revisionProbe" or "diagnostics.dropRevisionReply"
            ? new RegularRevisionUploads(c.FeatureFlagProvider)
            : c.FeatureFlagProvider;
        var drive = new ProtonDriveClient(http,account,c.CacheRepository,flags,c.Telemetry);
        using var timeout=new CancellationTokenSource(TimeSpan.FromMinutes(3));var ct=timeout.Token;
        JsonNode result;
        switch(op){
            case "drive.root":result=NodeDto(await drive.GetMyFilesFolderAsync(ct));break;
            case "drive.workspaceFolder":
                result = NodeDto(await WorkspaceFolder(drive, NodeUid.Parse(Text(p, "rootId")),
                    p["scopeRootId"]?.GetValue<string>() is { } scopeId ? NodeUid.Parse(scopeId) : null, ct));
                break;
            case "drive.workspaceList":
                result = await WorkspaceList(drive, p, ct);
                break;
            case "drive.workspaceFavoritesRead":
                result = await WorkspaceFavoritesRead(drive, p, ct);
                break;
            case "drive.workspaceFavoritesWrite":
                result = await WorkspaceFavoritesWrite(drive, p, ct);
                break;
            case "drive.workspaceProfilesRead":
                result = await WorkspaceProfilesRead(drive, p, ct);
                break;
            case "drive.workspaceProfilesWrite":
                result = await WorkspaceProfilesWrite(drive, p, ct);
                break;
            case "drive.workspaceRead":
            {
                var ancestors = new List<NodeUid>();
                var workspaceFile = await WorkspaceFile(drive, p, ct, ancestors);
                var extension = Path.GetExtension(VerifiedName(workspaceFile)).ToLowerInvariant();
                var search = p["search"]?.GetValue<bool>() == true;
                var package = p["package"]?.GetValue<bool>() == true;
                var office = extension is ".docx" or ".xlsx";
                var expectedRevision = p["expectedRevisionId"]?.GetValue<string>();
                if (expectedRevision != null && workspaceFile.ActiveRevision.Uid.ToString() != expectedRevision)
                    throw new Failure("stale-node");
                var officeRevision = p["officeRevisionId"]?.GetValue<string>();
                if (officeRevision != null && (!office || workspaceFile.ActiveRevision.Uid.ToString() != officeRevision))
                    throw new Failure("stale-node");
                var readLimit = package ? 8 * 1024 * 1024 : search
                    ? 2 * 1024 * 1024
                    : extension switch
                    {
                        ".pdf" => 12 * 1024 * 1024,
                        ".mp3" or ".wav" or ".ogg" or ".flac" or ".m4a" or ".mp4" or ".webm" => 16 * 1024 * 1024,
                        ".knote" or ".nbnote" or ".docx" or ".xlsx" => 8 * 1024 * 1024,
                        ".txt" or ".csv" or ".tsv" or ".log" or ".json" => 1024 * 1024,
                        _ => MaxContent,
                    };
                result = office && !search && !package && officeRevision == null
                    ? new JsonObject
                    {
                        ["node"] = NodeDto(workspaceFile),
                        ["revisionId"] = workspaceFile.ActiveRevision.Uid.ToString(),
                        ["contentBase64"] = "",
                    }
                    : await ReadFileJson(drive, workspaceFile, ct, readLimit);
                ancestors.Reverse();
                result["ancestorIds"] = new JsonArray(ancestors.Select(uid => (JsonNode?)JsonValue.Create(uid.ToString())).ToArray());
                break;
            }
            case "drive.workspaceStat":
                result = NodeDto(await WorkspaceMarkdown(drive, p, ct));
                break;
            case "drive.workspaceFileStat":
            {
                var ancestors = new List<NodeUid>();
                result = NodeDto(await WorkspaceFile(drive, p, ct, ancestors));
                ancestors.Reverse();
                result["ancestorIds"] = new JsonArray(ancestors.Select(uid => (JsonNode?)JsonValue.Create(uid.ToString())).ToArray());
                break;
            }
            case "drive.workspaceFolderStat":
            {
                var ancestors = new List<NodeUid>();
                var folder = await Within(drive, NodeUid.Parse(Text(p, "nodeId")),
                    NodeUid.Parse(Text(p, "rootId")), ct, traceAncestors: ancestors);
                if (folder is not FolderNode || ReservedWorkspaceMetadataName(VerifiedName(folder)))
                    throw new Failure("not-folder");
                result = NodeDto(folder);
                ancestors.Reverse();
                result["ancestorIds"] = new JsonArray(ancestors.Select(uid => (JsonNode?)JsonValue.Create(uid.ToString())).ToArray());
                break;
            }
            case "drive.workspaceAsset":
                result = await WorkspaceAsset(drive, p, ct);
                break;
            case "drive.workspaceUploadImage":
                result = await WorkspaceUploadImage(drive, p, ct);
                break;
            case "drive.workspaceTreeEdit":
                try { result = await WorkspaceTreeEdit(drive, p, ct); }
                catch (NodeWithSameNameExistsException) { throw new Failure("name-conflict"); }
                catch (NodeOutOfSyncException) { throw new Failure("stale-node"); }
                break;
            case "drive.workspaceTrashList":
                result = await WorkspaceTrashList(drive, p, ct);
                break;
            case "drive.workspaceTrashRestore":
                result = await WorkspaceTrashRestore(drive, p, ct);
                break;
            case "drive.workspaceTrashCheck":
                result = await WorkspaceTrashCheck(drive, p, ct);
                break;
            case "drive.writeRevision":
                result = await WriteWorkspaceRevision(drive, p, ct);
                break;
            case "diagnostics.revisionProbe":
                var competitor = new ProtonDriveClient(http,account,c.CacheRepository,flags,c.Telemetry);
                result = await RevisionProbe(drive, competitor, p, ct);
                break;
            case "diagnostics.dropRevisionReply":
                result = await DropRevisionReply(drive, p, ct);
                break;
            case "drive.events":
                var root = p["rootId"]?.GetValue<string>() is { } scopeRoot
                    ? await WorkspaceFolder(drive, NodeUid.Parse(scopeRoot), null, ct)
                    : await drive.GetMyFilesFolderAsync(ct);
                var previousCursor=p["cursor"]?.GetValue<string>();
                DriveEventId? cursor=string.IsNullOrEmpty(previousCursor)?null:(DriveEventId)previousCursor;
                var nextCursor=previousCursor;var changed=false;var refresh=cursor==null;var count=0;
                await foreach(var e in drive.EnumerateEventsAsync(root.TreeEventScopeId,cursor,ct)){
                    if(++count>10000)throw new Failure("event-limit");
                    nextCursor=e.Id.ToString();
                    if(e is EventsContinuityLostEvent || e is EventsScopeAccessLostEvent){refresh=true;changed=true;}
                    else if(e is not EventsCursorAdvancedEvent)changed=true;
                }
                result=new JsonObject{["cursor"]=nextCursor,["changed"]=changed,["requiresRefresh"]=refresh};break;
            case "drive.list":
                var items=new JsonArray();
                await foreach(var id in drive.EnumerateFolderChildrenNodeUidsAsync(NodeUid.Parse(Text(p,"parentId")),ct)){
                    if(items.Count>=10000)throw new Failure("inventory-limit");
                    var n=await drive.GetNodeAsync(id,ct)??throw new Failure("incomplete-inventory");items.Add((JsonNode)NodeDto(n));
                }
                result=new JsonObject{["items"]=items,["complete"]=true};break;
            case "drive.createFolder":
                var parent=NodeUid.Parse(Text(p,"parentId"));var folderName=Text(p,"name");
                var existing=await Find(drive,parent,folderName,ct);
                if(existing!=null){if(existing is FileNode)throw new Failure("name-conflict");result=NodeDto(existing);}
                else result=NodeDto(await drive.CreateFolderAsync(parent,folderName,null,ct));break;
            case "drive.readFile":
                var file=await drive.GetNodeAsync(NodeUid.Parse(Text(p,"nodeId")),ct) as FileNode??throw new Failure("not-file");
                result=await ReadFileJson(drive,file,ct);break;
            case "drive.writeFile":
                var encoded=p["contentBase64"]?.GetValue<string>()??throw new Failure("invalid-request");
                if(encoded.Length>MaxContent*4L/3+4)throw new Failure("file-too-large");
                var content=Convert.FromBase64String(encoded);if(content.Length>MaxContent)throw new Failure("file-too-large");
                var target=NodeUid.Parse(Text(p,"parentId"));var name=Text(p,"name");
                var previous=await Find(drive,target,name,ct);
                if(previous!=null){
                    if(previous is not FileNode same || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(await Read(drive,same,ct)),SHA256.HashData(content)))throw new Failure("content-conflict");
                    result=NodeDto(same);result["bytes"]=content.Length;result["revisionId"]=same.ActiveRevision.Uid.ToString();break;
                }
                using(var input=new MemoryStream(content)){
                    using var uploader=await drive.GetFileUploaderAsync(target,name,p["mediaType"]?.GetValue<string>()??"application/octet-stream",content.Length,new FileUploadMetadata(),false,ct);
                    await using var controller=uploader.UploadFromStream(input,[],null,()=>SHA1.HashData(content),ct);
                    var uploaded=await controller.Completion;result=new JsonObject{["id"]=uploaded.NodeUid.ToString(),["nodeId"]=uploaded.NodeUid.ToString(),["name"]=name,["type"]="file",["bytes"]=content.Length,["revisionId"]=uploaded.RevisionUid.ToString()};
                }break;
            default:throw new Failure("unsupported-operation");
        }
        var tokens=await api.TokenCredential.GetTokensAsync(ct);s["accessToken"]=tokens.AccessToken;s["refreshToken"]=tokens.RefreshToken;
        return Ok(result,s);
    }
    static async Task<Node?> Find(ProtonDriveClient drive,NodeUid parent,string name,CancellationToken ct){
        Node? match=null;var count=0;
        await foreach(var id in drive.EnumerateFolderChildrenNodeUidsAsync(parent,ct)){
            if(++count>10000)throw new Failure("inventory-limit");
            var n=await drive.GetNodeAsync(id,ct)??throw new Failure("incomplete-inventory");
            if(!n.Name.TryGetValueElseError(out var nname,out _))throw new Failure("unverified-node-name");
            if(nname==name){if(match!=null)throw new Failure("ambiguous-name");match=n;}
        }
        return match;
    }
    static async Task<byte[]> Read(ProtonDriveClient drive,FileNode file,CancellationToken ct,int limit=MaxContent){
        if (file.ActiveRevision.ClaimedSize is { } size && size > limit)
            throw new Failure("file-too-large");
        using var output=new BoundedStream(limit);
        using var downloader=await drive.GetFileDownloaderAsync(file.ActiveRevision.Uid,ct);
        await using var controller=downloader.DownloadToStream(output,(_,_)=>{},ct);
        await controller.Completion;
        if(controller.GetIsDownloadCompleteWithVerificationIssue())throw new Failure("content-verification-failed");
        return output.ToArray();
    }
    sealed class BoundedStream(int limit):MemoryStream{
        void Check(int n){if(Position+n>limit)throw new Failure("file-too-large");}
        public override void Write(byte[] b,int o,int n){Check(n);base.Write(b,o,n);}
        public override void Write(ReadOnlySpan<byte> b){Check(b.Length);base.Write(b);}
        public override Task WriteAsync(byte[] b,int o,int n,CancellationToken ct){Check(n);return base.WriteAsync(b,o,n,ct);}
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> b,CancellationToken ct=default){Check(b.Length);return base.WriteAsync(b,ct);}
    }
}
