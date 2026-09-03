;; tsukuru.design/sim の product 宣言ローダ — cron bot が使う。
;; products/*.edn を読み、tsukuru.design/product で検証して返す。
;; 宣言の :placements は {:part/id "..." :at [x y z]} の形 (design/place に翻訳)。
(ns tsukuru.load
  (:require [tsukuru.design :as design]
            [clojure.edn :as edn]
            #?(:cljs ["fs" :as fs])))

(defn load-decl
  "1 つの宣言 EDN (products/*.edn の中身) を design/product に通す。
   戻り値は検証済み product (寸法導出済み)。"
  [decl]
  (let [by-id (into {} (map (fn [p] [(:part/id p) p])) (:parts decl))
        placements
        (mapv (fn [{:keys [part/id at]}]
                (let [p (get by-id id)]
                  (when-not p
                    (throw (ex-info (str "placement references unknown part: " id) {})))
                  (design/place p at)))
              (:placements decl))]
    (design/product {:product/id (:product/id decl)
                     :product/name (:product/name decl)
                     :product/fulfillment-mode (:product/fulfillment-mode decl)
                     :parts (:parts decl)
                     :wall-mm (:wall-mm decl)
                     :placements placements})))

(defn- read-file [path]
  #?(:clj (slurp path)
     :cljs (fs.readFileSync path "utf8")))

(defn all-products
  "products/ の全宣言を読んで検証する。戻り値は [{:file ... :product ...}]。
   1 つでも落ちたらそのファイル名と例外を記録して続行 (静かに落とさない)。"
  [dir]
  (for [f (seq (fs/readdirSync dir))
        :when (.endsWith f ".edn")]
    (let [path (str dir "/" f)]
      (try
        {:file f
         :product (load-decl (edn/read-string (read-file path)))}
        (catch :default e
          {:file f :error (.-message e)})))))
