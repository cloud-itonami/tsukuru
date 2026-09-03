# products/ — product 宣言

1 ファイル = 1 product (EDN)。tsukuru-design-review が審査し、tsukuru-sim が
sim に通し、tsukuru-rfq が production_order 申立て候補として載せる。

形式 (tsukuru.design/product が読む形):

```edn
{:product/id "my-product"
 :product/name "..."
 :product/fulfillment-mode :cto  ; :bto | :mto | :cto
 :wall-mm 3
 :parts [{:part/id "..." :part/name "..." :part/envelope [x y z]
          :part/mass-g N :part/mounts-on "親 id" :part/insert-axis :z
          :part/power-w N :part/qty 1 :part/fit-class :fit|:standard|:loose}]}
```
