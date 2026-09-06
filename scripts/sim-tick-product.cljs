(require '[tsukuru.load :as load] '[tsukuru.sim :as sim])
(let [r (first (load/all-products "products"))]
  (if (:error r)
    (println "LOAD-ERROR")
    (let [f (:findings (sim/run-sim (:product r)))]
      (prn {:product (get-in r [:product :product/id]) :passed? (empty? f) :kinds (mapv :kind f)}))))