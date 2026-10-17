# LÜDI ISLAND CLASH – Online Alpha (V54)

Dieses Paket ergänzt das Spiel um **öffentliche Matchmaking-Lobbys** und **private Lobbys mit Einladungscode**. Ein laufender Server ist nötig: Eine einzelne HTML-Datei kann keine gemeinsamen Online-Räume für andere Computer hosten.

## Was in dieser Alpha online funktioniert

- Öffentliche Lobbys und private Räume mit fünfstelligen Einladungscodes.
- Bis zu 12 verbundene Menschen je Raum.
- Spieler-Avatare, Namen, Positionen, Blickrichtung und Mini-Map-Punkte werden synchronisiert.
- Treffer zwischen Online-Spielern werden über den Server weitergegeben.
- Die Map wird beim Erzeugen mit einem festen Seed angelegt, damit die statische Landschaft zwischen Clients möglichst übereinstimmt.

**Noch nicht vollständig synchronisiert:** Bots, Zombie-/Boss-KI, Loot, Gebäude-Schäden, Bauwerke, Zone, Rang-/Währungs-Speicherung und alle Welt-Events werden weiterhin lokal auf jedem Computer simuliert. Deshalb ist dies eine spielbare Online-Alpha und noch kein vollständig server-authoritatives Battle Royale. Admin-Funktionen sind clientseitig und kein sicherer Multiplayer-Adminzugang.

## Lokal starten (zum Testen auf deinem Computer)

1. Installiere Node.js 18 oder neuer, falls es noch nicht installiert ist.
2. Entpacke die ZIP-Datei in einen normalen Ordner.
3. Öffne den entpackten Ordner im Datei-Explorer.
4. Klicke oben in die Adressleiste, tippe `cmd` und drücke Enter.
5. Gib diese Befehle nacheinander in das schwarze Fenster ein:

   ```text
   npm install
   npm start
   ```

6. Öffne im Browser `http://localhost:3000`.
7. Klicke auf **ONLINE · ÖFFENTLICH & PRIVAT**. Zwei Browserfenster auf demselben Computer können für einen ersten Test derselben Lobby beitreten.

Die ZIP-Datei enthält absichtlich keine `.bat`-Installationsdatei.

## Mit Freunden über das Internet spielen

Damit Freunde von anderen Computern beitreten können, muss der Server unter einer öffentlichen HTTPS-Adresse laufen. Eine mögliche Methode:

1. Lade die vier Dateien `index.html`, `server.js`, `package.json` und `render.yaml` in ein eigenes GitHub-Repository hoch.
2. Erstelle in einem Webhosting-Dashboard einen **Node-Web-Service**, der dieses Repository verwendet.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Nach dem Deployment öffnest du die öffentliche HTTPS-Adresse. Das Lobby-Fenster verwendet diese Adresse automatisch für die sichere WebSocket-Verbindung (`wss://.../ws`). Teile die Adresse mit Freunden.

Bei kostenlosen Test-Instanzen kann der erste Verbindungsversuch nach einer Leerlaufzeit länger dauern, weil der Dienst schlafen gelegt und wieder gestartet werden muss.

## Gesundheitstest

`/healthz` gibt ein kleines JSON-Statusobjekt zurück.
