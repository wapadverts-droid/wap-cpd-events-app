"""Bundle the app into one self-contained page.

Writes index.html at the repository root, which is what GitHub Pages serves.
Run:  python3 build.py
"""
import base64
import pathlib

root = pathlib.Path(__file__).parent
src = root / 'src'
logo = base64.b64encode((root / 'assets' / 'logo.jpg').read_bytes()).decode()
js = '\n'.join((src / f).read_text() for f in ['core.js', 'seed.js', 'store.js', 'pdf.js', 'app.js'])
html = (src / 'template.html').read_text()
html = html.replace('/*__CSS__*/', (src / 'styles.css').read_text())
html = html.replace('/*__LOGO__*/', 'data:image/jpeg;base64,' + logo)
html = html.replace('/*__JS__*/', js.replace('</script', '<\\/script'))
out = root / 'index.html'
out.write_text(html)
print(out, len(html) // 1024, 'KB')
