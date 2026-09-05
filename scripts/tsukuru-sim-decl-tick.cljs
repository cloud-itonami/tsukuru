;; tsukuru-sim tick: products/*.edn を load.all-products で読み sim.run-sim に通す (nbb -e 禁止)
(require '[tsukuru.load :as load]
         '[tsukuru.sim :as sim])

(defn- append-line [path form]
  (let [fs (js/require "fs")]
    (.appendFileSync fs path (str form "\n"))))

(doseq [{:keys [file product error]} (load/all-products "products")]
  (if error
    (do (prn {:file file :error error}))
    (let [res (sim/run-sim product)
          findings (:findings res)
          passed? (empty? findings)
          line {:at (.toISOString (js/Date.)) :product (:product/id product)
                :passed? passed? :findings (count findings)
                :kinds (mapv :kind findings)}]
      (prn line)
      (append-line "status/last-sim-decl-tick.edn" line))))
