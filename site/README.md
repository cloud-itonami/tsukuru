# tsukuru 設計・sim・usd (site/)

製品設計の正本 — 部材 envelope + クリアランス規則から製品寸法を導出し、
物理 sim を通して OpenUSD で書き出す。すべて純 .cljc (nbb / cljs / JVM 可搬)。

| ns | 役割 |
|---|---|
| `tsukuru.design` | 部材 → BOM → 配置 → 外寸導出 (`hull`)。寸法はコードに焼かない |
| `tsukuru.sim` | AABB 干渉 / 公差 stack-up / 挿入経路 / 質量重心。**AABB レベルであってメッシュ精度の衝突判定ではない** (ADR-2607270000 §8 を引き継ぐ) |
| `tsukuru.usd` | OpenUSD (usda テキスト) 書き出し。metersPerUnit = 0.001、upAxis Z。Isaac Sim / Omniverse 互換の import 境界 |
| `tsukuru.model` | サンプル製品 (MK-1 sandwich)。部材カタログの正本ではない |

## 実行

```bash
# テスト
nbb --classpath site scripts/tsukuru-sim-test.cljs

# 公開面の生成 (public/sites/app/tsukuru/)
nbb --classpath site scripts/generate-tsukuru-site.cljs
```

## NVIDIA 互換性の位置づけ

sim コアは NVIDIA に依存しない。境界だけを OpenUSD に揃えている:

- 幾何は AABB envelope primitive (Cube + xformOp:translate/scale)
- 質量は `custom double massGrams`
- sim findings は usda 冒頭コメント (`# tsukuru.sim findings: ...`)

将来 NVIDIA hosted API / Isaac Sim を刺すときは、この usda をそのまま食わせる
か、`tsukuru.sim` を PhysX 呼び出しに差し替える (戻り値の findings 形は不変)。

## 部材の正本

MK-1 部材の一次データは superproject `90-docs/hardware/mk1-parts.datoms.edn`
(ADR-2607270000)。`tsukuru.model` はその簡易射影であり、衝突したら ADR 側が正。
