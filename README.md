# 🇫🇮 Finland-quizet

En frågesport för hela sällskapet: frågorna visas på TV:n (t.ex. Google TV) och alla svarar från sina egna telefoner.

**Kategorier** (30 frågor var): Finlands historia · Finlands geografi · Finlands natur · Musik · eller **Blandat** (alla 120).
Man väljer kategori, antal frågor och tid per fråga innan spelet startar.

## Kom igång

Du behöver en dator (Windows, Mac eller Linux) med [Node.js](https://nodejs.org) 18 eller nyare, i samma wifi som TV:n och telefonerna.

```bash
npm install
npm start
```

Servern skriver ut en adress, t.ex. `http://192.168.1.23:3000`.

## Visa på Google TV

Välj ett av sätten:

1. **Webbläsare på TV:n** – installera en webbläsare från Play Butik på Google TV (t.ex. *TV Bro*), och öppna adressen som servern skrev ut. Tryck *Helskärm*.
2. **Casta från datorn** – öppna adressen i Chrome på datorn, välj ⋮ → *Casta…* → din Google TV och *Casta flik*. Tryck sedan *Helskärm* i quizet.

## Så spelar man

1. TV:n visar en **QR-kod** och en fyrbokstavs **spelkod**.
2. Alla skannar QR-koden med telefonen (eller går till `adressen/spela` och skriver koden) och anger sitt namn.
3. Den första som går med blir **spelledare 👑** och väljer kategori, antal frågor och tid direkt på telefonen. Det går också att välja med TV:ns fjärrkontroll.
4. Spelledaren trycker **Starta**. Frågan visas på TV:n och svarsalternativen i färg på telefonerna.
5. Rätt svar ger 500 poäng + upp till 500 bonuspoäng för snabbhet.
6. Efter varje fråga visas rätt svar och ställningen. Nästa fråga kommer automatiskt efter 12 sekunder (eller när spelledaren trycker *Nästa*).
7. Till sist visas prispallen. *Spela igen* tar alla tillbaka till lobbyn.

Om en telefon låser sig eller tappar anslutningen går den automatiskt tillbaka in i spelet med samma poäng.

## Lägga till egna frågor

Frågorna finns i [`questions.js`](questions.js). Varje fråga har formen:

```js
{ q: 'Frågan?', a: 'Rätt svar', w: ['Fel 1', 'Fel 2', 'Fel 3'] },
```

Svarsalternativen blandas automatiskt. Det går att lägga till fler frågor i en kategori eller en helt ny kategori i `CATEGORIES`.

## Filer

| Fil | Innehåll |
| --- | --- |
| `server.js` | Webbserver och spellogik (Express + Socket.IO) |
| `questions.js` | Frågebanken |
| `public/tv.html`, `public/tv.js` | TV-skärmen |
| `public/play.html`, `public/play.js` | Telefonernas vy |
| `public/common.js`, `public/style.css` | Delad kod och utseende |
