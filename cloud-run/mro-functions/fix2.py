path = 'index.js'
with open(path) as f:
    content = f.read()
old = "const SHEET_USER_NAME = '';"
esc = chr(0x5c)
hexcodes = ['C0AC','C6A9','C790','D300','B9C8','C2A4','D130']
new = "const SHEET_USER_NAME = '" + ''.join(esc + 'u' + h for h in hexcodes) + "';"
assert old in content, "pattern not found"
content = content.replace(old, new)
with open(path, 'w') as f:
    f.write(content)
print(new)
