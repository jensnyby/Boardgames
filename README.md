# 🇫🇮 Finland-quizet

En frågesport för hela sällskapet: frågorna visas på TV:n (t.ex. Google TV) och alla svarar från sina egna telefoner.

**Kategorier** (30 frågor var): Finlands historia · Finlands geografi · Finlands natur · Musik · Första hjälpen · Mat · Transportbokning · Plastprofiltillverkning · Framtidens sjöfartsbränslen · Inspektion i Österbottens välfärdsområde · Sport · 🚂 På spåret · 🎧 Gissa låten (Finland) · 🌍 Gissa låten – internationellt · eller **Blandat** (alla 420).
Man väljer kategori, svårighetsgrad (🟢 Lätt, 🟡 Medel, 🔴 Svår eller Alla), antal frågor och tid per fråga innan spelet startar. Varje kategori har 10 frågor per svårighetsgrad.

## Kom igång

Spelet behöver **ingen egen server**. Allt finns i mappen [`public/`](public) och kan läggas på vilket gratis webbhotell som helst.
TV:ns webbläsare sköter spelet och telefonerna kopplar upp sig direkt mot den (WebRTC). Den kostnadsfria tjänsten [PeerJS](https://peerjs.com) används bara för att TV:n och telefonerna ska hitta varandra. TV:n och telefonerna behöver internet, men de behöver inte vara i samma wifi.

### Alternativ 1: Netlify Drop (enklast, gratis)

1. Gå till <https://app.netlify.com/drop> och skapa ett gratis konto.
2. Dra mappen `public` till sidan.
3. Du får en adress, t.ex. `https://finland-quiz.netlify.app`, som du kan byta namn på under *Site configuration*.

### Alternativ 2: GitHub Pages

GitHub Pages är gratis för publika repon. Gör repot publikt under *Settings → General → Danger Zone*, och välj sedan *Settings → Pages → Source: GitHub Actions*.
Därefter publiceras spelet automatiskt vid varje push till `main`, på `https://jensnyby.github.io/Boardgames/`.

### Alternativ 3: Lokalt på en dator

```bash
npm install
npm start
```

Öppna sedan `http://localhost:3000`.

## Visa på Google TV

1. Installera en webbläsare från Play Butik på Google TV, t.ex. *TV Bro*.
2. Öppna spelets adress och tryck *Helskärm*. Tips: spara adressen som bokmärke.

Det går också att casta en Chrome-flik från en dator (⋮ → *Casta…* → *Casta flik*).

## Så spelar man

1. TV:n visar en **QR-kod** och en fyrbokstavs **spelkod**.
2. Alla skannar QR-koden med telefonen (eller går till adressen som visas och skriver koden) och anger sitt namn.
3. Den första som går med blir **spelledare 👑** och väljer kategori, antal frågor och tid direkt på telefonen. Det går också att välja med TV:ns fjärrkontroll.
4. Spelledaren trycker **Starta**. Frågan visas på TV:n och svarsalternativen i färg på telefonerna.
5. Rätt svar ger 500 poäng + upp till 500 bonuspoäng för snabbhet.
6. Efter varje fråga visas rätt svar och ställningen. Nästa fråga kommer automatiskt efter 12 sekunder (eller när spelledaren trycker *Nästa*).
7. Till sist visas prispallen. Med **📋 Rätta svar** går man igenom alla frågor med rätt svar och hur många som svarade rätt. På telefonen ser var och en sina egna svar markerade med ✅ eller ❌. *Spela igen* tar alla tillbaka till lobbyn.

Vill ni sluta i förtid trycker ni **⏹ Avsluta** på TV:n eller på spelledarens telefon, och trycker igen för att bekräfta. Spelet hoppar då till slutresultatet med poängen hittills.

Om en telefon låser sig eller tappar anslutningen går den automatiskt tillbaka in i spelet med samma poäng. Även TV-sidan kan laddas om mitt i spelet utan att något försvinner.

## 🎵 Bakgrundsmusik

Under frågorna spelar TV:n en glad slinga som skapas direkt i webbläsaren (inga musikfiler). Den pausas medan Gissa låten spelar sitt klipp. Slå av och på med **🎵 Musik på/av** i lobbyn eller under spelet; valet sparas på TV:n. Precis som för Gissa låten måste man trycka på **🔇 Slå på ljudet** (eller valfri knapp) på TV:n innan ljudet får spelas.

## 🚂 På spåret

Som i TV-programmet: vart är vi på väg? TV:n visar fem ledtrådar om en stad någonstans i världen, en ny var 8:e sekund, från svår till lätt. Svarar man rätt redan på första ledtråden får man 1000 poäng, sedan 800, 600, 400 och 200. Varje fråga tar 40 sekunder oavsett inställd tid.

## 🎧 Gissa låten

TV:n spelar ett 30 sekunders klipp av en låt (finländsk eller internationell, beroende på kategori), och spelarna gissar vad låten heter eller vem som framför den. Efter frågan visas låten med skivomslag.

- Klippen hämtas från **Apples gratis förhandslyssning** (iTunes sök-API). Inget konto behövs.
- Webbläsare får bara spela ljud efter ett knapptryck. Tryck på **🔇 Slå på ljudet** på TV:n (eller valfri knapp med fjärrkontrollen) innan ni startar. Om ljudet ändå blockeras visas knappen *▶ Spela upp låten*.
- Låtar som inte hittas hoppas över automatiskt.
- Låtlistorna finns under `gissa` (Finland) och `gissaint` (internationellt) i [`public/questions.js`](public/questions.js) och har formen `{ artist: 'Käärijä', title: 'Cha Cha Cha' }`. Artistnamn och titel ska skrivas som på Apple Music.

Spotify fungerar inte här: Spotifys regler för utvecklare förbjuder spel och frågesporter med Spotifys musik, och nya appar får inte längre tillgång till Spotifys ljudklipp.

## Lägga till egna frågor

Frågorna finns i [`public/questions.js`](public/questions.js). Varje fråga har formen:

```js
{ d: 2, q: 'Frågan?', a: 'Rätt svar', w: ['Fel 1', 'Fel 2', 'Fel 3'] },
```

`d` är svårighetsgraden: 1 = lätt, 2 = medel, 3 = svår. Svarsalternativen blandas automatiskt. Det går att lägga till fler frågor i en kategori eller en helt ny kategori i `CATEGORIES`.

## Filer

| Fil | Innehåll |
| --- | --- |
| `public/index.html`, `public/tv.js` | TV-skärmen |
| `public/host.js` | Spellogiken (körs i TV:ns webbläsare) |
| `public/spela.html`, `public/play.js` | Telefonernas vy |
| `public/questions.js` | Frågebanken och låtlistan |
| `public/songs.js` | Hämtar ljudklipp till Gissa låten |
| `public/music.js` | Bakgrundsmusiken |
| `public/common.js`, `public/style.css` | Delad kod och utseende |
| `public/vendor/` | PeerJS och QR-kodsbibliotek |
| `server.js` | Valfri lokal webbserver |
