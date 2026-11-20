fn main() {
    // Cargo does not track the icon, so regenerating it (`tauri icon`) leaves the old one
    // embedded in the exe until something else forces a relink. Declaring it here means a
    // new icon is picked up on the next build instead of needing `cargo clean -p`.
    println!("cargo:rerun-if-changed=icons/icon.ico");

    // Tauri's default manifest only carries the Common-Controls v6 dependency. We skip it
    // here and embed our own manifest (below) into every unit of this package instead, so
    // the app exe and the test exes all get exactly one RT_MANIFEST. The icon and version
    // resources Tauri compiles are unaffected.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
    )
    .expect("tauri-build failed");

    embed_windows_manifest();
}

/// Every exe this package links — the app bin and the `cargo test` exes alike — needs an
/// application manifest declaring a dependency on Common-Controls v6. Without one the
/// Windows loader binds `comctl32.dll` to the v5 copy in System32, which has no
/// `TaskDialogIndirect`, and the process dies at startup with
/// STATUS_ENTRYPOINT_NOT_FOUND before `main` runs. Tauri's manifest embedding is
/// disabled above (it uses `rustc-link-arg-bins`, so it would collide with ours —
/// ld.lld rejects two RT_MANIFEST resources in one image), and this windres-compiled
/// resource object is passed via plain `rustc-link-arg`, which reaches the bin, the
/// lib `--test` exe, and integration tests alike.
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn embed_windows_manifest() {
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let version = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "1.0.0".to_string());
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is always set"));
    let manifest = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="{version}.0" name="com.zuno.app" type="win32"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df"
        language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>
"#
    );
    let manifest_path = out_dir.join("zuno.manifest");
    let rc_path = out_dir.join("zuno.rc");
    let obj_path = out_dir.join("zuno-manifest.o");
    fs::write(&manifest_path, manifest).expect("write manifest");
    fs::write(&rc_path, "1 24 \"zuno.manifest\"\n").expect("write rc file");

    let status = Command::new(env::var("WINDRES").unwrap_or_else(|_| "windres".to_string()))
        .arg("--target=pe-x86-64")
        .arg(&rc_path)
        .arg("-O")
        .arg("coff")
        .arg("-o")
        .arg(&obj_path)
        .current_dir(&out_dir)
        .status()
        .expect("failed to run windres");
    assert!(status.success(), "windres failed for {}", rc_path.display());

    println!("cargo:rustc-link-arg={}", obj_path.display());
}

#[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
fn embed_windows_manifest() {}
