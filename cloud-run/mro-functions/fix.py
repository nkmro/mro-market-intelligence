path = 'index.js'
with open(path) as f:
    content = f.read()
old = "const SHEET_NAME = '';"
esc = chr(0x5c)
new = "const SHEET_NAME = '" + esc + "uB514" + esc + "uBC84" + esc + "uADF8" + esc + "uB85C" + esc + "uADF8';"
assert old in content, "pattern not found"
content = content.replace(old, new)
with open(path, 'w') as f:
    f.write(content)
print(new)
