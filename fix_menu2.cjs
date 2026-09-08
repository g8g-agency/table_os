const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'src/apps/customer/pages/MenuHome.jsx');
let content = fs.readFileSync(p, 'utf8');

const targetStyle = "        style={{\n" +
"          background: \linear-gradient(135deg, \, \)\,\n" +
"          padding: '14px 18px',\n" +
"          display: 'flex',\n" +
"          alignItems: 'center',\n" +
"          justifyContent: 'space-between',\n" +
"          cursor: 'pointer',\n" +
"          userSelect: 'none',\n" +
"        }}";

const newStyle = "        style={{\n" +
"          background: \linear-gradient(135deg, \, \)\,\n" +
"          padding: '14px 18px',\n" +
"          display: 'flex',\n" +
"          alignItems: 'center',\n" +
"          justifyContent: 'space-between',\n" +
"          cursor: 'pointer',\n" +
"          userSelect: 'none',\n" +
"          scrollMarginTop: 185,\n" +
"        }}";

content = content.replace(targetStyle, newStyle);
fs.writeFileSync(p, content);
console.log('done2');
