(require '[tsukuru.load :as load] '[tsukuru.sim :as sim])
(def rs (load/all-products "products"))
(doseq [r rs]
  (if (:error r)
    (do (println "LOAD FAIL" (:file r)) (println "  " (:error r)))
    (let [p (:product r)
          s (sim/run-sim p)]
      (println "OK" (:file r) (:product/id p)
               "dims" (:product/outer-dims p)
               "vol" (:product/volume-l p)
               "passed?" (:passed? s))
      (doseq [f (:findings s)]
        (println "  finding" (:kind f) (or (:parts f) (:note f)))))))
