"""Build a signed APK from clean temporary output, preserving the release identity."""
from pathlib import Path
import hashlib
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

base = Path(__file__).resolve().parent
# Keep SDKs and signing material outside the application source tree.
toolchain = Path(os.environ.get(
    'ELITE_ANDROID_TOOLCHAIN',
    '/Users/mac/Documents/Codex/2026-10-19/users-mac-documents/work/android-build',
))
jdk = toolchain / 'jdk-17.0.21+9/Contents/Home/bin'
tools = toolchain / 'sdk-tools/android-15'
platform = toolchain / 'sdk-platform/android-35/android.jar'
app = base / 'app'
private = Path(os.environ.get('ELITE_ANDROID_SIGNING_DIR', str(toolchain / 'private-signing')))
password = private / 'store-password.txt'
keystore = private / 'elite-scholars-release.jks'
if not password.is_file() or not keystore.is_file():
    raise RuntimeError('The existing private release signing key is required; no new key is generated.')

android_ns = '{http://schemas.android.com/apk/res/android}'
manifest = ET.parse(app / 'AndroidManifest.xml').getroot()
version = manifest.attrib[android_ns + 'versionName']
if not all(part.isdigit() for part in version.split('.')):
    raise RuntimeError('The Android version must contain numeric components.')
release = Path(os.environ.get('ELITE_ANDROID_OUTPUT', str(base / 'releases'))).resolve()
release.mkdir(parents=True, exist_ok=True)
apk = release / ('Elite-Scholars-Diary-' + version + '.apk')
if apk.exists():
    raise RuntimeError('Release APK already exists. Choose a new release directory or version.')


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True, cwd=base)


run(jdk / 'java', '-version')
with tempfile.TemporaryDirectory(prefix='elite-android-') as temporary:
    out = Path(temporary)
    classes, dex, generated = (out / name for name in ('classes', 'dex', 'generated'))
    for directory in (classes, dex, generated):
        directory.mkdir()
    run(tools / 'aapt2', 'compile', '--dir', app / 'res', '-o', out / 'resources.zip')
    run(tools / 'aapt2', 'link', '-o', out / 'unsigned.apk', '-I', platform,
        '--manifest', app / 'AndroidManifest.xml', '--java', generated,
        '-A', app / 'assets', out / 'resources.zip')
    run(jdk / 'javac', '--release', '8', '-encoding', 'UTF-8', '-classpath', platform,
        '-d', classes, *sorted(app.glob('src/**/*.java')))
    run(jdk / 'java', '-cp', tools / 'lib/d8.jar', 'com.android.tools.r8.D8',
        '--lib', platform, '--min-api', '26', '--output', dex,
        *sorted(classes.glob('**/*.class')))
    with zipfile.ZipFile(out / 'unsigned.apk', 'a', zipfile.ZIP_STORED) as archive:
        archive.write(dex / 'classes.dex', 'classes.dex')
    run(tools / 'zipalign', '-f', '4', out / 'unsigned.apk', out / 'aligned.apk')
    run(jdk / 'java', '-jar', tools / 'lib/apksigner.jar', 'sign',
        '--ks', keystore, '--ks-key-alias', 'elite-scholars',
        '--ks-pass', 'file:' + str(password), '--v1-signing-enabled', 'false',
        '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true',
        '--v4-signing-enabled', 'false', '--out', apk, out / 'aligned.apk')
run(jdk / 'java', '-jar', tools / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', apk)
run(tools / 'aapt2', 'dump', 'badging', apk)
print('APK_FILE=' + str(apk))
print('SHA256=' + hashlib.sha256(apk.read_bytes()).hexdigest())
