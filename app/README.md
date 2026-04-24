# Emoji System App (Windows)

Desktop app de dung emoji/sticker ca nhan tren toan he thong.

## Tinh nang

- Global shortcut: Ctrl+Shift+Space de mo picker.
- Neu shortcut tren bi trung, app tu fallback sang Ctrl+Alt+Space hoac Alt+Shift+E.
- UI tim kiem emoji theo alias, ten, group.
- Tu dong sinh alias tu thu muc ../emojis.
- Text expander toan he thong: go :alias roi bam Space/Enter/Tab de app tu dan sticker (anh) vao ung dung dang focus.
- Alias tuy chinh ngan trong file data/custom-aliases.json (vi du :ff, :jl, :pom).
- Favorites + Recent de mo nhanh sticker dung nhieu.
- Man hinh Settings trong app de them/sua/xoa custom alias ngay tren UI.

## Cai dat

1. Cai Node.js 20+.
2. Mo terminal tai thu muc app.
3. Chay:

```powershell
npm install
npm run index
npm start
```

## Alias tuy chinh ngan

Co 2 cach:

1. Mo Settings trong app (khuyen dung) va sua truc tiep tren giao dien.
2. Sua tay file data/custom-aliases.json.

File: data/custom-aliases.json

Format:

```json
{
	"ff": "pom-pom-gallery-farewell-penacony-set-15-firefly-1",
	"jl": "pom-pom-gallery-jolted-awake-from-a-winter-dream-jingliu-1",
	"pom": "pom-pom-stickers-set-1-pom-pom-1"
}
```

Cot trai la alias ngan ban muon go, cot phai la alias goc duoc sinh trong data/emoji-index.json.

Sau khi sua custom alias, khoi dong lai app de nhan cau hinh moi.

## Quy tac alias

Alias duoc sinh tu ten folder + ten file.

Vi du:

- File: emojis/Pom-Pom Stickers Set 1/Pom-Pom 1.png
- Alias: :pom-pom-stickers-set-1-pom-pom-1

Neu trung alias thi he thong tu them hau to -2, -3, ...

## Thu nghiem nhanh

1. Mo app bang npm start.
2. Sau khi app mo, giao dien picker se hien ngay. Neu ban da an cua so, bam Ctrl+Shift+Space de mo lai.
3. Neu Ctrl+Shift+Space khong hoat dong, thu Ctrl+Alt+Space roi den Alt+Shift+E.
4. Neu khong thay cua so, tim icon Emoji Dock trong system tray va double click de mo.
5. Tim emoji va Enter.
6. Chuyen sang app dich (Discord, Zalo, Notion...) va bam Ctrl+V.

Text expander:

1. Trong app dich, go :alias
2. Bam Space hoac Enter
3. App se xoa chu vua go va paste anh sticker
4. Vi du alias day du: :pom-pom-stickers-set-1-pom-pom-1

Favorites + Recent:

1. Nhan nut * tren card de them/bo Favorites.
2. Recent duoc cap nhat moi lan pick tu picker hoac text expander.
3. Trang thai duoc luu trong userData cua Electron, van con sau khi tat app.

## Mo rong

- Them cap nhat alias ngay trong UI (khong can sua JSON tay).
- Them startup with Windows va tray icon.
- Them profile sync (OneDrive/Git) cho custom aliases + favorites.

## Build ra file .exe installer

Chay lenh sau trong thu muc app:

```powershell
npm install
npm run build:win
```

Ket qua se nam trong thu muc dist, thuong la file NSIS installer .exe de cai dat 1 lan tren may.

## Luu y

- Mot so app co co che bao mat cao co the chan global input hook.
- Neu app dich khong ho tro paste image, hay dung che do picker va gui file/anh theo cach rieng cua app do.
