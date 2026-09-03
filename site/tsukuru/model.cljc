(ns tsukuru.model
  "サンプル製品の正本 — MK-1 の部材データ (90-docs/hardware/mk1-parts.datoms.edn
   の ADR-2607270000 確定値) を product 形に落としたもの。
   これは example であって部材カタログの正本ではない (正本は superproject 側)。")

(require '[tsukuru.design :as design])

(def mk1-parts
  [(design/part {:part/id "mobo" :part/name "mini-ITX motherboard"
                 :part/envelope [170 170 40] :part/mass-g 600
                 :part/fit-class :standard})
   (design/part {:part/id "cpu-cooler" :part/name "low-profile cooler 95x95x37"
                 :part/envelope [95 95 37] :part/mass-g 420
                 :part/mounts-on "mobo" :part/fit-class :fit})
   (design/part {:part/id "psu" :part/name "SFX 750W"
                 :part/envelope [125 63.5 100] :part/mass-g 1200
                 :part/fit-class :standard})
   (design/part {:part/id "gpu" :part/name "dual-slot blower GPU"
                 :part/envelope [267 39 111] :part/mass-g 1100
                 :part/fit-class :standard})
   (design/part {:part/id "riser" :part/name "Gen5 x16 riser"
                 :part/envelope [80 10 60] :part/mass-g 80
                 :part/mounts-on "mobo" :part/fit-class :fit})])

(def mk1
  "sandwich 配置: board 室 (mobo + cooler + riser) と GPU 室を X 方向に並べる。
   PSU は board 室の手前 Z。壁 3mm。"
  (design/product
   {:product/id "mk1-enclosure-sandwich"
    :product/name "叢雲 MK-1 sandwich enclosure"
    :product/fulfillment-mode :cto
    :parts mk1-parts
    :wall-mm 3
    :placements
    [(design/place (nth mk1-parts 0) [3 3 3])            ; mobo
     (design/place (nth mk1-parts 1) [20 20 5])          ; cooler (on mobo)
     (design/place (nth mk1-parts 2) [3 3 150])          ; psu
     (design/place (nth mk1-parts 3) [186 60 8])         ; gpu (GPU室, X後方)
     (design/place (nth mk1-parts 4) [100 60 8])]}))     ; riser
