"""Package exactly the three install files, with reproducible ZIP metadata."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import shutil
ROOT = Path(__file__).resolve().parent.parent
FILES = ('main.js','manifest.json','styles.css')
def main():
    version=json.loads((ROOT/'manifest.json').read_text())['version']
    output=ROOT/'artifacts';output.mkdir(exist_ok=True)
    archive=output/f'learning-hub-{version}.zip'
    with ZipFile(archive,'w',compression=ZIP_DEFLATED) as z:
        for name in FILES:
            shutil.copyfile(ROOT/name,output/name)
            info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
            z.writestr(info,(ROOT/name).read_bytes())
    print(f'Created installation archive for {version}')
if __name__=='__main__': main()
