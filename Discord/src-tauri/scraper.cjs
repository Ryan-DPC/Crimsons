const https = require('https');
const fs = require('fs');

const options = {
  hostname: 'www.op.gg',
  port: 443,
  path: '/champions/akali/build',
  method: 'GET',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    const match = data.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
    if (match) {
      console.log('Found NEXT_DATA length:', match[1].length);
      fs.writeFileSync('opgg.json', match[1]);
    } else {
      console.log('No NEXT_DATA found, statusCode:', res.statusCode);
      fs.writeFileSync('opgg.html', data);
    }
  });
});

req.on('error', error => { console.error(error); });
req.end();
