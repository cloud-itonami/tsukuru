;; tsukuru.itonami.cloud — app.itonami.cloud/tsukuru/ を生成する
;; (inkan と同型、ADR-2607301300 の共通クローム規律に従う)。
;;
;; 設計の正本は site/tsukuru/*.cljc。生成器は product を実際に sim に通し、
;; 結果 (findings を含む) を公開面に描く。拒否 0 件でも sim passed でも
;; 「実際に回した」ことの証拠として usda を 1 本出す。
;;
;; Run (tsukuru repo root から):
;;   nbb --classpath "site:../cloud-itonami/scripts" scripts/generate-tsukuru-site.cljs
(require '[clojure.edn :as edn]
         '["fs" :as fs]
         '["path" :as path]
         '[tsukuru.design :as design]
         '[tsukuru.sim :as sim]
         '[tsukuru.usd :as usd]
         '[tsukuru.model :as model])

(def out-dir "public/sites/app/tsukuru")

(defn- write! [rel content]
  (let [p (path/join out-dir rel)]
    (fs/mkdirSync (path/dirname p) #js {:recursive true})
    (fs/writeFileSync p content "utf8")))

(defn- esc [s] (-> (str s) (clojure.string/replace "&" "&amp;")
                   (clojure.string/replace "<" "&lt;") (clojure.string/replace ">" "&gt;")))

;; ── 実回し: product を sim に通す ────────────────────────────────────────────
(def product model/mk1)
(def sim-result (sim/run-sim product))
(def usda (usd/product->usda product))

;; ── HTML ────────────────────────────────────────────────────────────────────
(defn finding-row [f]
  (str "<tr><td><code>" (esc (:kind f)) "</code></td><td>" (esc (name (:severity f)))
       "</td><td>" (esc (clojure.string/join ", " (map str (:parts f))))
       "</td><td>" (esc (or (:note f) "")) "</td></tr>"))

(defn part-row [p]
  (let [dims (mapv - (:part/max-corner p) (:part/origin p))]
    (str "<tr><td><code>" (esc (:part/id p)) "</code></td><td>"
         (esc (clojure.string/join " × " dims)) " mm</td><td>"
         (esc (str (or (:part/mounts-on p) "—"))) "</td><td>"
         (esc (str (or (:part/insert-axis p) "z"))) "</td></tr>")))

(def html
  (str "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">"
       "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
       "<title>tsukuru — 製品設計と物理 sim</title>"
       "<meta name=\"description\" content=\"部材 envelope から製品を設計し、AABB 干渉・公差 stack-up・挿入経路の物理 sim を通して、OpenUSD で NVIDIA 互換に書き出す。\">"
       "<style>body{font-family:system-ui,sans-serif;margin:0 auto;max-width:52rem;padding:2rem;line-height:1.6}"
       "table{border-collapse:collapse;width:100%;margin:1rem 0}"
       "th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left;font-size:.9rem}"
       "th{background:#f5f5f5}.pass{color:#0a7d32}.err{color:#b3261e}</style></head><body>"
       "<h1>tsukuru — 製品設計と物理 sim</h1>"
       "<p>部材 envelope + クリアランス規則から製品寸法を導出し（" (esc (:product/name product)) "）、"
       "AABB 干渉 / 公差 stack-up / 挿入経路 / 質量重心の sim を通し、"
       "OpenUSD (usda) として書き出す。NVIDIA Isaac Sim / Omniverse 互換の import 境界。</p>"
       "<h2>製品: " (esc (:product/name product)) "</h2>"
       "<p>fulfillment: <code>" (esc (name (:product/fulfillment-mode product))) "</code> · "
       "外寸 " (esc (clojure.string/join " × " (:product/outer-dims product))) " mm · "
       "体積 " (:product/volume-l product) " L · "
       "質量 " (:product/mass-g product) " g · "
       "電力 " (:product/power-w product) " W</p>"
       "<h3>部材 (" (count (:product/placements product)) ")</h3>"
       "<table><thead><tr><th>部材</th><th>envelope</th><th>嵌合親</th><th>挿入軸</th></tr></thead><tbody>"
       (apply str (map part-row (:product/placements product)))
       "</tbody></table>"
       "<h2>sim 判定: " (if (:passed? sim-result)
                          "<span class=\"pass\">passed</span>"
                          "<span class=\"err\">findings あり</span>") "</h2>"
       (if (seq (:findings sim-result))
         (str "<table><thead><tr><th>kind</th><th>severity</th><th>parts</th><th>note</th></tr></thead><tbody>"
              (apply str (map finding-row (:findings sim-result)))
              "</tbody></table>")
         "<p>欠陥なし。</p>")
       "<h2>OpenUSD 書き出し</h2>"
       "<p><a href=\"./mk1-enclosure-sandwich.usda\" download>mk1-enclosure-sandwich.usda</a> — "
       "Isaac Sim / Omniverse にそのまま import できる (単位 mm、upAxis Z)。"
       "幾何は AABB envelope であって厳密 BREP ではない (ADR-2607270000 §8 の限界を引き継ぐ)。</p>"
       "<p>sim findings は usda 冒頭のコメントに載る: <code># tsukuru.sim findings: ...</code></p>"
       "<footer style=\"margin-top:3rem;font-size:.85rem;color:#666\">"
       "設計の正本: site/tsukuru/*.cljc (純 .cljc、nbb 実行) · "
       "sim の限界: AABB レベル、熱は経験式、CFD ではない</footer></body></html>"))

;; ── 書き出し ────────────────────────────────────────────────────────────────
(fs/mkdirSync out-dir #js {:recursive true})
(write! "index.html" html)
(write! "mk1-enclosure-sandwich.usda"
        (str usda (usd/findings->usda-feedback sim-result)))
(println "generated" out-dir)
(println "sim passed?:" (:passed? sim-result))
(println "findings:" (count (:findings sim-result)))
