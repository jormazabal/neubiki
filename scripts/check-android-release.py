"""Release packaging gate; stdlib only, never installs or reads user data."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import struct
import subprocess
import zipfile

PROVIDER_LIBRARIES = {"libneubiki_proton.so", "libproton_crypto.so", "libcrypto.so", "libssl.so"}
APP_LIBRARY = "libneubiki_desktop_lib.so"
SYSTEM_LIBRARIES = {"libc.so", "libm.so", "libdl.so", "liblog.so", "libz.so", "libandroid.so"}
EXPORTS = {"neubiki_proton_request", "neubiki_proton_response_length", "neubiki_proton_free"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def elf_info(data, abi):
    if len(data) < 64 or data[:6] != b"\x7fELF\x02\x01":
        raise ValueError("Expected little-endian ELF64 native library")
    machine = struct.unpack_from("<H", data, 18)[0]
    if machine != {"arm64-v8a": 183, "x86_64": 62}[abi]:
        raise ValueError("Native library ABI does not match packaged ABI")
    phoff, shoff = struct.unpack_from("<QQ", data, 32)
    phsize, phcount, shsize, shcount = struct.unpack_from("<HHHH", data, 54)
    if phsize != 56 or phcount > 256 or shcount > 8192:
        raise ValueError("Unsupported ELF header")
    headers = [struct.unpack_from("<IIQQQQQQ", data, phoff + i * phsize) for i in range(phcount)]
    loads = [h for h in headers if h[0] == 1]
    if not loads or any(h[7] < 16384 or h[7] & (h[7] - 1) for h in loads):
        raise ValueError("Native LOAD segments must support Android 16 KB pages")
    api = None
    for h in headers:
        if h[0] != 4:
            continue
        offset, end = h[2], h[2] + h[5]
        while offset + 12 <= end:
            namesize, descsize, kind = struct.unpack_from("<III", data, offset)
            offset += 12
            name = data[offset:offset + namesize].rstrip(b"\0")
            offset += (namesize + 3) & ~3
            descriptor = data[offset:offset + descsize]
            offset += (descsize + 3) & ~3
            if name == b"Android" and kind == 1 and len(descriptor) >= 4:
                api = struct.unpack_from("<I", descriptor)[0]

    def address_offset(address):
        for h in loads:
            if h[3] <= address < h[3] + h[5]:
                return h[2] + address - h[3]
        raise ValueError("ELF dynamic string table outside mapped data")

    dynamic = []
    for h in headers:
        if h[0] == 2:
            for offset in range(h[2], h[2] + h[5], 16):
                tag, value = struct.unpack_from("<qQ", data, offset)
                if not tag:
                    break
                dynamic.append((tag, value))
    table = next((value for tag, value in dynamic if tag == 5), None)
    needed = []
    if table is not None:
        table_offset = address_offset(table)
        for tag, value in dynamic:
            if tag == 1:
                needed.append(data[table_offset + value:].split(b"\0", 1)[0].decode("ascii"))
    if set(needed) - SYSTEM_LIBRARIES - PROVIDER_LIBRARIES:
        raise ValueError("Unpackaged native dependency: " + ", ".join(sorted(set(needed) - SYSTEM_LIBRARIES - PROVIDER_LIBRARIES)))
    exports = set()
    if shcount:
        if shsize != 64:
            raise ValueError("Unsupported ELF section table")
        sections = [struct.unpack_from("<IIQQQQIIQQ", data, shoff + i * shsize) for i in range(shcount)]
        for section in sections:
            if section[1] != 11:
                continue
            strings = sections[section[6]]
            string_data = data[strings[4]:strings[4] + strings[5]]
            if section[9] != 24:
                raise ValueError("Unsupported ELF dynamic symbol table")
            for offset in range(section[4], section[4] + section[5], 24):
                name, info, other, index, value, size = struct.unpack_from("<IBBHQQ", data, offset)
                if index and name:
                    exports.add(string_data[name:].split(b"\0", 1)[0].decode("ascii"))
    return {"abi": abi, "androidApi": api, "loadAlignment": min(h[7] for h in loads), "dependencies": sorted(needed), "exports": exports}


def verify_native(data, name, abi, expected_api):
    info = elf_info(data, abi)
    # NativeAOT may carry the runtime pack's older CRT note (21). A lower note
    # is compatible; the actual provider feature remains explicitly gated at 29.
    if info["androidApi"] is None or info["androidApi"] > expected_api:
        raise ValueError(f"{name}: native Android API exceeds {expected_api} or is unknown")
    if name == "libneubiki_proton.so" and not EXPORTS <= info["exports"]:
        raise ValueError("Native Proton bridge ABI exports missing")
    if name == APP_LIBRARY and set(info["dependencies"]) & PROVIDER_LIBRARIES:
        raise ValueError("The app must load its Proton provider lazily")
    info.pop("exports")
    return {"name": name, "bytes": len(data), "sha256": digest(data), **info}


def native_receipt(directory, notices, abi):
    directory, notices = pathlib.Path(directory), pathlib.Path(notices)
    names = {p.name for p in directory.iterdir() if p.suffix == ".so"}
    if names != PROVIDER_LIBRARIES:
        raise ValueError("Native provider directory must contain exactly four expected SO libraries")
    libraries = [verify_native((directory / name).read_bytes(), name, abi, 29) for name in sorted(names)]
    notices_files = [{"name": str(p.relative_to(notices)).replace("\\", "/"), "sha256": digest(p.read_bytes()), "bytes": p.stat().st_size} for p in sorted(notices.rglob("*")) if p.is_file()]
    required = {"Proton-Drive-SDK-MIT.txt", "Proton-Cryptography-MIT.txt", "OpenSSL-Apache-2.0.txt", "Android-native-provenance.txt", "THIRD-PARTY-NOTICES.txt"}
    if not required <= {p["name"] for p in notices_files}:
        raise ValueError("Native redistribution licenses or provenance missing")
    return {"schemaVersion": 1, "abi": abi, "providerApi": 29, "libraries": libraries, "notices": notices_files}


def check_badging(badging, version, baseline):
    package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
    if not package or package.group(1) != baseline["applicationId"] or package.group(3) != version:
        raise ValueError("APK production applicationId/version mismatch")
    expected_code = sum(int(p) * n for p, n in zip(version.split("."), [1000000, 1000, 1]))
    first_candidate = expected_code == baseline["firstVersionCode"] == baseline["versionCode"]
    if int(package.group(2)) != expected_code or (expected_code <= baseline["versionCode"] and not first_candidate):
        raise ValueError("APK versionCode must match VERSION and advance the Neubiki baseline")
    if "application-debuggable" in badging:
        raise ValueError("Production APK must not be debuggable")
    minimum = re.search(r"sdkVersion:'(\d+)'", badging)
    if not minimum or int(minimum.group(1)) != baseline["minimumSdk"]:
        raise ValueError("APK minimum SDK does not preserve the supported baseline")
    native = re.search(r"native-code:(.*)", badging)
    if not native or re.findall(r"'([^']+)'", native.group(1)) != ["arm64-v8a"]:
        raise ValueError("Android release must contain only arm64-v8a")
    return {"applicationId": package.group(1), "versionName": version, "versionCode": expected_code, "minimumSdk": int(minimum.group(1))}


def check_signature(output, baseline):
    signers = re.findall(r"certificate SHA-256 digest:\s*([0-9a-fA-F]{64})", output)
    if signers != [baseline["certificateSha256"]] or "Verified using v2 scheme (APK Signature Scheme v2): true" not in output:
        raise ValueError("APK signature does not continue the production release certificate")
    return signers[0]


def check_zip(apk, receipt, app_library):
    if len(receipt["libraries"]) != 4 or {row["name"] for row in receipt["libraries"]} != PROVIDER_LIBRARIES:
        raise ValueError("Native receipt must verify all four provider binaries")
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("APK has duplicate ZIP entries")
        expected = {"lib/arm64-v8a/" + name for name in PROVIDER_LIBRARIES | {APP_LIBRARY}}
        if {n for n in names if n.endswith(".so")} != expected:
            raise ValueError("APK must include exactly five expected ARM64 native libraries")
        for library in receipt["libraries"]:
            data = archive.read("lib/arm64-v8a/" + library["name"])
            if digest(data) != library["sha256"]:
                raise ValueError("APK provider binary differs from verified native build")
            verify_native(data, library["name"], "arm64-v8a", 29)
        app_data = archive.read("lib/arm64-v8a/" + APP_LIBRARY)
        if digest(app_data) != digest(pathlib.Path(app_library).read_bytes()):
            raise ValueError("APK application binary differs from the staged release build")
        app = verify_native(app_data, APP_LIBRARY, "arm64-v8a", 29)
        if "assets/licenses/Noto-OFL.txt" not in names:
            raise ValueError("APK bundled font license is missing")
        for notice in receipt["notices"]:
            entry = "assets/licenses/proton/" + notice["name"]
            if entry not in names or digest(archive.read(entry)) != notice["sha256"]:
                raise ValueError("APK native license/provenance missing or changed")
    return app


def adapter_sources(directory):
    return {
        file.name: digest(file.read_text(encoding="utf-8").encode("utf-8"))
        for file in directory.iterdir() if file.suffix in (".cs", ".csproj")
    }


def verify_native_receipt(repo, receipt_path):
    receipt = json.loads(receipt_path.read_text(encoding="utf-8-sig"))
    if receipt["schemaVersion"] != 1 or receipt["abi"] != "arm64-v8a" or receipt["providerApi"] != 29:
        raise ValueError("Unverified native Android build receipt")

    adapter = repo / "native/proton-sdk"
    pins = json.loads((adapter / "pins.json").read_text())
    provenance = receipt["provenance"]
    expected = {
        "sdkRevision": pins["sdk"]["revision"],
        "cryptoRevision": pins["crypto"]["revision"],
        "cryptoCargoLockSha256": digest((adapter / pins["crypto"]["cargoLock"]).read_bytes()),
        "dotnetSdk": pins["dotnetSdk"],
        "rustToolchain": pins["rustToolchain"],
        "openssl": pins["openssl"],
        "ndk": pins["androidNdk"],
        "providerApi": 29,
    }
    if any(provenance.get(key) != value for key, value in expected.items()) or receipt.get("adapterSources") != adapter_sources(adapter):
        raise ValueError("Android SDK source provenance does not match the current pinned adapter")

    source_bundle = receipt_path.parent.parent / "neubiki-proton-android-sources.zip"
    openssl = receipt_path.parent / f"openssl-{pins['openssl']['version']}.tar.gz"
    for file, sha256 in ((source_bundle, provenance["sourceBundleSha256"]), (openssl, pins["openssl"]["sha256"])):
        if digest(file.read_bytes()) != sha256:
            raise ValueError(f"Android corresponding source archive differs from its receipt: {file.name}")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-dir")
    parser.add_argument("--notices-dir")
    parser.add_argument("--abi", default="arm64-v8a", choices=["arm64-v8a", "x86_64"])
    parser.add_argument("--apk")
    parser.add_argument("--native-receipt")
    parser.add_argument("--app-library")
    parser.add_argument("--build-tools")
    parser.add_argument("--version")
    parser.add_argument("--out")
    args = parser.parse_args()
    repo = pathlib.Path(__file__).resolve().parent.parent
    if args.native_dir:
        result = native_receipt(args.native_dir, args.notices_dir, args.abi)
        result["adapterSources"] = adapter_sources(repo / "native/proton-sdk")
        if args.native_receipt:
            receipt = verify_native_receipt(repo, pathlib.Path(args.native_receipt))
            for field in ("libraries", "notices"):
                if receipt[field] != result[field]:
                    raise ValueError(f"Staged Android native {field} differ from the verified build")
            print("Android native staging gate PASS")
            return
    else:
        baseline = json.loads((repo / "scripts/android-release-baseline.json").read_text())
        tools = pathlib.Path(args.build_tools)
        suffix = ".bat" if os.name == "nt" else ""
        signature = subprocess.run([str(tools / ("apksigner" + suffix)), "verify", "--verbose", "--print-certs", args.apk], check=True, capture_output=True, text=True).stdout
        aapt = tools / ("aapt.exe" if suffix else "aapt")
        badging = subprocess.run([str(aapt), "dump", "badging", args.apk], check=True, capture_output=True, text=True).stdout
        identity = check_badging(badging, args.version, baseline)
        certificate = check_signature(signature, baseline)
        zipalign = tools / ("zipalign.exe" if suffix else "zipalign")
        subprocess.run([str(zipalign), "-c", "-P", "16", "4", args.apk], check=True)
        receipt = verify_native_receipt(repo, pathlib.Path(args.native_receipt))
        app = check_zip(args.apk, receipt, args.app_library)
        result = {"schemaVersion": 1, **identity, "certificateSha256": certificate, "apkSha256": digest(pathlib.Path(args.apk).read_bytes()), "appLibrary": app, "providerLibraries": receipt["libraries"], "nativeProvenance": receipt.get("provenance"), "notices": receipt["notices"], "signingBaseline": baseline, "validated": True}
    result["checkedAtUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if not args.out:
        parser.error("--out is required for a new receipt")
    destination = pathlib.Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("Android packaging gate PASS: " + str(destination))


if __name__ == "__main__":
    main()
