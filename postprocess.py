"""Turn table row separators from dashed (pptxgenjs only offers 'dash') into dotted lines, per the Focal style."""
import shutil
import sys
import tempfile
import zipfile

src = sys.argv[1]
tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pptx").name
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename.startswith("ppt/slides/slide") and item.filename.endswith(".xml"):
            data = data.replace(b'<a:prstDash val="sysDash"/>', b'<a:prstDash val="sysDot"/>')
        zout.writestr(item, data)
shutil.move(tmp, src)
print("dotted table rules:", src)
