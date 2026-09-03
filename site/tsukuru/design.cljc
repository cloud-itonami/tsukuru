(ns tsukuru.design
  "Product 設計の正本 — 部材 envelope + クリアランス規則から製品寸法を導出する。
   寸法をコードに焼かない (ADR-2607270000 §1 の規律の tsukuru 版)。
   部材は EDN で宣言し、この ns は純関数だけを持つ (.cljc — nbb/cljs/JVM 可搬)。")

;; ── 部材 ────────────────────────────────────────────────────────────────────

(defn part
  "部材 1 点。envelope は [x y z] mm、mounts-on は嵌合親 (嵌合部は envelope が
   重なるのが正常 — sim の干渉判定で親子は除外する)。"
  [{:keys [part/id part/name part/envelope part/mass-g part/mounts-on
           part/qty part/insert-axis part/power-w]}]
  (when-not id
    (throw (ex-info "part requires :part/id" {})))
  (when-not (and (vector? envelope) (= 3 (count envelope))
                 (every? number? envelope))
    (throw (ex-info (str "part " id " requires :part/envelope [x y z] mm") {})))
  {:part/id id
   :part/name (or name id)
   :part/envelope envelope
   :part/mass-g (or mass-g 0)
   :part/mounts-on mounts-on
   :part/qty (or qty 1)
   :part/insert-axis (or insert-axis :z)
   :part/power-w (or power-w 0)})

(defn bill-of-materials
  "部材リストから BOM を作る。重複 id は拒否する (静かに潰さない)。"
  [parts]
  (let [ids (map :part/id parts)
        dupes (->> (frequencies ids) (filter (fn [[_ n]] (> n 1))) (map first))]
    (when (seq dupes)
      (throw (ex-info (str "duplicate part ids: " (pr-str dupes)) {})))
    (vec parts)))

;; ── 配置 ────────────────────────────────────────────────────────────────────

(defn- axis-idx [axis]
  ({:x 0 :y 1 :z 2} axis))

(defn place
  "部材を原点 (min corner) [x y z] に置く。位置は設計者の宣言であって
   solver が解かない (org-iso-10303 brep.assembly が transform を解かないのと同じ)。"
  [{:part/keys [id envelope] :as p} [x y z]]
  {:part/id id
   :part/envelope envelope
   :part/origin [x y z]
   :part/max-corner (mapv + [x y z] envelope)
   :part/insert-axis (:part/insert-axis p)
   :part/mounts-on (:part/mounts-on p)
   :part/mass-g (:part/mass-g p)
   :part/qty (:part/qty p)})

(defn placed-parts [placed]
  (mapv #(select-keys % [:part/id :part/envelope :part/origin :part/max-corner
                         :part/insert-axis :part/mounts-on]) placed))

;; ── 外寸の導出 ──────────────────────────────────────────────────────────────

(defn hull
  "配置済み部材 + 壁厚 per-axis から外寸 (min/max corner) を導出する。
   内寸は部材の hull、外寸はそれ + 壁。"
  [placed wall-mm]
  (when-not (and (number? wall-mm) (pos? wall-mm))
    (throw (ex-info "wall-mm must be a positive number" {})))
  (let [mins (apply mapv min (map :part/origin placed))
        maxs (apply mapv max (map :part/max-corner placed))
        inner [(- (maxs 0) (mins 0)) (- (maxs 1) (mins 1)) (- (maxs 2) (mins 2))]]
    {:inner-min mins
     :inner-max maxs
     :inner-dims inner
     :outer-dims (mapv + inner [wall-mm wall-mm wall-mm])
     :volume-l (/ (apply * (mapv + inner [wall-mm wall-mm wall-mm])) 1000000)}))

(defn total-mass-g [placed]
  (reduce + 0 (map (fn [p] (* (or (:part/mass-g p) 0) (or (:part/qty p) 1))) placed)))

(defn total-power-w [placed]
  (reduce + 0 (map (fn [p] (* (or (:part/power-w p) 0) (or (:part/qty p) 1))) placed)))

;; ── 製品設計の正本 ──────────────────────────────────────────────────────────

(defn product
  "product = 名前 + BOM + 配置 + 壁厚。寸法は hull が導出する。
   戻り値は設計の正本で、sim と usd export の両方がこれを食う。"
  [{:keys [product/id product/name product/fulfillment-mode parts wall-mm
           placements]}]
  (when-not id
    (throw (ex-info "product requires :product/id" {})))
  (when-not (#{:bto :mto :cto} fulfillment-mode)
    (throw (ex-info (str "product " id ": fulfillment-mode must be :bto/:mto/:cto")
                    {})))
  (let [bom (bill-of-materials parts)
        placed (or placements
                   (mapv (fn [p] (place p [0 0 0])) bom))
        h (hull placed wall-mm)]
    {:product/id id
     :product/name (or name id)
     :product/fulfillment-mode fulfillment-mode
     :product/bom bom
     :product/placements (placed-parts placed)
     :product/outer-dims (:outer-dims h)
     :product/inner-dims (:inner-dims h)
     :product/volume-l (:volume-l h)
     :product/mass-g (total-mass-g placed)
     :product/power-w (total-power-w placed)
     :design/wall-mm wall-mm
     :design/hull h}))
