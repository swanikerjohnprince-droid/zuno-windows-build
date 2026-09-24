# AUR packaging

`zuno` repackages the published `.deb`. Edit it here, not in the AUR repo — this is what the
workflow pushes.

## Publishing

`.github/workflows/aur.yml` runs on every published release: bumps `pkgver`, refreshes the
checksum from the shipped artifact, regenerates `.SRCINFO`, builds the package, then pushes.

Requires the repository secret **`AUR_SSH_PRIVATE_KEY`**.

To publish without cutting a release:

```
Actions → AUR → Run workflow → version: 1.2.1
```

## Editing by hand

Only `PKGBUILD` and `.SRCINFO` go to the AUR. The AUR reads `.SRCINFO`, so regenerate it after
any PKGBUILD change or the old version keeps being served:

```bash
makepkg --printsrcinfo > .SRCINFO
```

Bump `pkgrel` instead of `pkgver` when only the packaging changed. The workflow always resets
`pkgrel` to 1, so a packaging-only fix has to go through a manual run.

## Notes

- The GStreamer deps are load-bearing: without `gst-libav` playback fails with
  `GStreamer element appsink not found`.
- `conflicts=('zuno-bin')` — the community `zuno-bin` package installs the same files.
