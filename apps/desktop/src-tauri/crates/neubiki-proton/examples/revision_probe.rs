//! Opt-in live QA against a signed-in test account. The native vault holds the
//! session and the browser receives the one-time sign-in URL directly.

use neubiki_proton::Service;
use serde_json::{json, Value};
use std::{
    env,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args_os().skip(1);
    let library = args
        .next()
        .ok_or("Provide the absolute bridge library path")?;
    let directory = args
        .next()
        .ok_or("Provide an isolated account vault directory")?;
    let action = args.next().ok_or("Choose start, poll, probe, or inspect")?;
    if !Path::new(&library).is_absolute() || !Path::new(&directory).is_absolute() {
        return Err("Use absolute library and state paths".into());
    }
    let service = Service::new(directory.into(), library.into());
    match action.to_str() {
        Some("start") => {
            let launch = service.start()?;
            open_sign_in(&launch.sign_in_url)?;
            println!("Sign-in opened in Edge");
        }
        Some("poll") => {
            let status = service.status()?;
            let attempt = status["attempt"]["connectionId"]
                .as_str()
                .ok_or("No active connection attempt")?;
            let updated = service.poll(attempt)?;
            println!("Connected: {}", updated["account"]["state"] == "connected");
        }
        Some("probe") => {
            if args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .as_deref()
                != Some("--synthetic-fixture")
            {
                return Err("The probe writes in a new synthetic Proton folder. Pass --synthetic-fixture to proceed".into());
            }
            run_probe(&service)?;
        }
        Some("inspect") => {
            let name = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .ok_or("Provide the synthetic folder name")?;
            inspect_probe(&service, &name)?;
        }
        _ => return Err("Unknown probe action".into()),
    }
    Ok(())
}

#[cfg(windows)]
fn open_sign_in(url: &str) -> Result<(), Box<dyn std::error::Error>> {
    let edge = ["ProgramFiles(x86)", "ProgramFiles"]
        .into_iter()
        .filter_map(env::var_os)
        .map(|path| Path::new(&path).join("Microsoft/Edge/Application/msedge.exe"))
        .find(|path| path.is_file())
        .ok_or("Microsoft Edge installation not found")?;
    // Pass the access-bearing URL directly to the browser. Avoid shell parsing or logging.
    std::process::Command::new(edge).arg(url).spawn()?;
    Ok(())
}

#[cfg(not(windows))]
fn open_sign_in(_: &str) -> Result<(), Box<dyn std::error::Error>> {
    Err("The interactive probe uses Edge on Windows".into())
}

fn run_probe(service: &Service) -> Result<(), Box<dyn std::error::Error>> {
    let status = service.status()?;
    let account = get(&status["account"], "id")?;
    let drive = |op, payload| service.invoke(account, op, payload);
    let my_files = drive("drive.root", json!({}))?;
    let name = format!(
        "Neubiki 0.6 QA {}-{}",
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis(),
        std::process::id()
    );
    let folder = drive(
        "drive.createFolder",
        json!({"parentId":get(&my_files,"nodeId")?,"name":name}),
    )?;
    println!("Synthetic Proton folder {name}");
    let root_id = get(&folder, "nodeId")?;
    let assets = drive(
        "drive.createFolder",
        json!({"parentId":root_id,"name":"assets"}),
    )?;
    const IMAGE: &str = "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAIElEQVR4nGP4XKBIFcQwatCoQaMGjRo0atCoQZ8H3CAA2ntpLqZ/C9cAAAAASUVORK5CYII=";
    drive(
        "drive.writeFile",
        json!({
            "parentId":get(&assets,"nodeId")?,"name":"sample.png","mediaType":"image/png",
            "contentBase64":IMAGE
        }),
    )?;
    const MARKDOWN: &str = "IyBOZXViaWtpIHN5bnRoZXRpYyB3b3Jrc3BhY2UKCiFbT3JhbmdlIHNhbXBsZV0oYXNzZXRzL3NhbXBsZS5wbmcpCg==";
    let markdown = drive(
        "drive.writeFile",
        json!({
            "parentId":root_id,"name":"README.md","mediaType":"text/markdown",
            "contentBase64":MARKDOWN
        }),
    )?;
    let markdown_id = get(&markdown, "nodeId")?;
    let reread = drive(
        "drive.workspaceRead",
        json!({"rootId":root_id,"nodeId":markdown_id}),
    )?;
    let asset = drive(
        "drive.workspaceAsset",
        json!({
            "rootId":root_id,"nodeId":markdown_id,"relativePath":"assets/sample.png"
        }),
    )?;
    let fixture_readable = reread["contentBase64"] == MARKDOWN
        && asset["contentBase64"] == IMAGE
        && reread["revisionId"].is_string()
        && asset["revisionId"].is_string();
    println!("{}", json!({"markdownAndRelativeImage":fixture_readable}));
    if !fixture_readable {
        return Err("The workspace fixture could not be read by revision".into());
    }
    let short_seed = seed_revision_fixture(service, account, root_id, "CAS-short.md")?;
    let large_seed = seed_revision_fixture(service, account, root_id, "CAS-large.md")?;
    let fixture = drive(
        "diagnostics.revisionProbe",
        json!({
            "rootId":root_id,"authorizeSyntheticFixture":true,
            "shortNodeId":short_seed,"largeNodeId":large_seed
        }),
    )
    .map_err(|error| format!("Revision probe could not start: {}", error.code))?;
    if let Some(error) = fixture["probeError"].as_str() {
        return Err(format!(
            "Revision probe failed at {}: {error}",
            get(&fixture, "stage")?
        )
        .into());
    }
    let short = &fixture["short"];
    let large = &fixture["large"];
    let overlap = &fixture["overlap"];
    println!("{}", json!({"short":short,"large":large,"overlap":overlap}));

    let target = &fixture["lossFixture"];
    let node_id = get(target, "nodeId")?;
    let base = get(target, "revisionId")?;
    // Base64 for '# After lost reply\n'. This differs from both seeded and competing bytes.
    let desired = "IyBBZnRlciBsb3N0IHJlcGx5Cg==";
    let outcome = drive(
        "diagnostics.dropRevisionReply",
        json!({
            "rootId":root_id,"nodeId":node_id,"baseRevisionId":base,"contentBase64":desired,
            "authorizeSyntheticFixture":true
        }),
    );
    let dropped = outcome.is_err_and(|error| error.code == "synthetic-reply-lost");
    let observed = drive(
        "drive.workspaceRead",
        json!({"rootId":root_id,"nodeId":node_id}),
    )?;
    let confirmed_content = observed["contentBase64"] == desired
        && observed["node"]["nodeId"] == node_id
        && get(&observed, "revisionId")? != base;
    println!(
        "{}",
        json!({"simulatedReplyLost":dropped,"sameNodeNewRevisionObserved":confirmed_content})
    );

    let supplied = |result: &Value| {
        result["staleOutcome"] == "conflict"
            && result["sameNode"] == true
            && result["winnerPreserved"] == true
    };
    if !supplied(short)
        || !supplied(large)
        || overlap["oneWinnerPreserved"] != true
        || !dropped
        || !confirmed_content
    {
        return Err("The live probe did not establish the revision capability".into());
    }
    Ok(())
}

fn seed_revision_fixture(
    service: &Service,
    account: &str,
    root: &str,
    name: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

    let content = BASE64.encode("# Neubiki CAS synthetic fixture\n");
    let uploaded = service
        .invoke(
            account,
            "drive.writeFile",
            json!({
                "parentId":root,"name":name,"mediaType":"text/markdown","contentBase64":content
            }),
        )
        .map_err(|error| format!("Seed upload {name}: {}", error.code))?;
    let node_id = get(&uploaded, "nodeId")?;
    let revision_id = get(&uploaded, "revisionId")?;
    for delay in [0, 200, 600, 1500] {
        std::thread::sleep(std::time::Duration::from_millis(delay));
        let result = service.invoke(
            account,
            "drive.workspaceRead",
            json!({"rootId":root,"nodeId":node_id}),
        );
        match result {
            Ok(read) if read["revisionId"] == revision_id && read["contentBase64"] == content => {
                return Ok(node_id.to_owned());
            }
            Ok(_) => return Err(format!("Seed revision changed for {name}").into()),
            Err(error) if error.code == "not-found" => {}
            Err(error) => return Err(format!("Seed lookup {name}: {}", error.code).into()),
        }
    }
    Err(format!("Seed revision for {name} is not visible").into())
}
fn inspect_probe(service: &Service, name: &str) -> Result<(), Box<dyn std::error::Error>> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

    if !name.starts_with("Neubiki 0.6 QA ") {
        return Err("Choose a synthetic folder from the probe output".into());
    }
    let status = service.status()?;
    let account = get(&status["account"], "id")?;
    let drive = |op, payload| service.invoke(account, op, payload);
    let my_files = drive("drive.root", json!({}))?;
    let my_files_id = get(&my_files, "nodeId")?;
    let listing = drive("drive.workspaceList", json!({"parentId":my_files_id}))?;
    let root = listing["items"]
        .as_array()
        .ok_or("Missing root children")?
        .iter()
        .find(|item| item["type"] == "folder" && item["name"] == name)
        .ok_or("Synthetic folder does not exist")?;
    let root_id = get(root, "nodeId")?;
    let items = drive(
        "drive.workspaceList",
        json!({"rootId":root_id,"parentId":root_id}),
    )?;
    let mut documents = Vec::new();
    for entry in items["items"]
        .as_array()
        .ok_or("Missing fixture children")?
    {
        if entry["type"] != "file" || !get(entry, "name")?.starts_with("CAS-") {
            continue;
        }
        let file = drive(
            "drive.workspaceRead",
            json!({"rootId":root_id,"nodeId":get(entry,"nodeId")?}),
        )?;
        let bytes = BASE64.decode(get(&file, "contentBase64")?)?;
        let marker = match bytes.split(|byte| *byte == b'\n').next() {
            Some(b"# Neubiki CAS synthetic fixture") => "seed",
            Some(b"# Short revision") => "short",
            Some(b"# Large revision") => "large",
            Some(b"# First staged revision") => "staged",
            Some(b"# Competing revision") => "competing",
            Some(b"# After lost reply") => "observed-after-lost-reply",
            _ => "unexpected",
        };
        documents.push(marker);
    }
    documents.sort_unstable();
    println!(
        "{}",
        json!({"syntheticFolder":name,"revisionFixtures":documents})
    );
    Ok(())
}
fn get<'a>(value: &'a Value, key: &str) -> Result<&'a str, &'static str> {
    value[key]
        .as_str()
        .filter(|text| !text.is_empty())
        .ok_or("Missing field in the native response")
}
