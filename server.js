// Valfri lokal webbserver. Spelet i sig behöver ingen server – mappen public/ kan läggas på vilket webbhotell som helst.
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`\n🇫🇮  Finland-quizet: http://localhost:${PORT}\n`));
