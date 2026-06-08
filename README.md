# Resonite Translator (JP <-> EN, Gemma 4 E2B WebGPU)

ブラウザの Web Speech API で日本語/英語を聞き取り、`onnx-community/gemma-4-E2B-it-ONNX` を **WebGPU** でローカル実行して翻訳し、結果を Resonite ユーザー名ごとの WebSocket チャンネルに配信します。翻訳時は直近 5 件の確定翻訳をコンテキストとして渡します。

## 構成

```
Browser (Chrome, WebGPU)            Node server                    Resonite
  Web Speech API   ──┐    POST /publish?user=<name>
  UI + context      ─┼──▶  Map<user, Set<WS>>  ──── ws://host:8080/<name> ─▶ WS Client
                     │
                     └── translate locally with Gemma 4 E2B
```

- 翻訳はブラウザ内で完結（外部 API 不要、初回のみモデル DL）
- サーバは静的配信 + `/publish` 受け口 + WebSocket 中継のみ

## 起動

```powershell
npm install
npm start            # http://localhost:8080
```

`PORT=9000 npm start` でポート変更。

## GitHub Pages 版

GitHub Pages では静的 UI とブラウザ内翻訳を使えます。Resonite へ配信する WebSocket 中継は Node サーバーが必要なので、この PCで `npm start` も起動してください。

- Pages URL: `https://rabbuttz.github.io/resonite-webgpu-translator/`
- Pages からの既定中継先: `http://localhost:8080`
- 中継先を変える場合: `?relay=http://localhost:9000` のように指定
- モデル名を変える場合: `?model=onnx-community/gemma-4-E2B-it-ONNX`
- コンテキスト件数を変える場合: `?context=5`

## ブラウザ側

1. `http://localhost:8080` を **Chrome** で開く（WebGPU が要る）
2. 初回は Gemma 4 E2B の ONNX モデルがダウンロードされる（進捗が表示される）
3. 「送信先 Resonite ユーザー名」を入力
4. 翻訳方向を選び **Start**。マイク許可を出すと認識開始
5. 1 発話ごとに翻訳・配信される

## Resonite 側

WebSocket Client (ProtoFlux) で次の URL に接続:

```
ws://<このPCのLAN IP>:8080/<自分のResoniteユーザー名>
```

受信メッセージは JSON 文字列:

```json
{ "original": "...", "translated": "...", "direction": "ja2en", "ts": 1716500000000 }
```

`translated` を取り出して TextField に流し込めば字幕になります。同じ URL に複数クライアントを張ると全員にブロードキャストされます。

## エンドポイント

| Method | Path | 用途 |
|---|---|---|
| GET  | `/`              | 認識 UI |
| GET  | `/users`         | 現在 WS 接続中のユーザー名一覧 |
| POST | `/publish?user=<name>` | ブラウザから翻訳結果を受け取り該当ユーザーに中継 |
| WS   | `/<name>`        | Resonite 側の受信エンドポイント |

## 注意

- LAN 内利用前提、認証なし。インターネット公開しないこと
- Web Speech API は Chrome の実装上 Google サーバへ音声が送られる。完全オフラインにしたい場合は別途 Whisper 等への差し替えが必要
- WebGPU は Chrome / Edge の安定版でデフォルト有効。Firefox/Safari は環境依存
- Gemma 4 E2B は大きいモデルなので、初回ロードと推論は環境によって時間がかかります
