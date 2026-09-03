;; tsukuru sim/design/usd — nbb runner (nbb は test framework を持たないので自前 assert)
;; Run: nbb --classpath site scripts/tsukuru-sim-test.cljs
(require '[tsukuru.model :as model]
         '[tsukuru.design :as design]
         '[tsukuru.sim :as sim]
         '[tsukuru.usd :as usd])

(def failures (atom 0))
(defn check [name cond]
  (if cond
    (println "  ok " name)
    (do (swap! failures inc)
        (println "  FAIL" name))))
(defn throws? [f]
  (try (f) false (catch :default _ true)))

;; ── design ──
(println "design:")
(let [p [{:part/id "a" :part/origin [3 3 3] :part/max-corner [13 13 13]}
         {:part/id "b" :part/origin [20 5 5] :part/max-corner [25 10 10]}]
      h (design/hull p 3)]
  (check "hull outer dims" (= [25 13 13] (:outer-dims h)))
  (check "hull volume > 0" (pos? (:volume-l h))))
(check "duplicate part ids rejected"
       (throws? #(design/bill-of-materials
                  [(design/part {:part/id "x" :part/envelope [1 1 1]})
                   (design/part {:part/id "x" :part/envelope [2 2 2]})])))
(check "bad fulfillment mode rejected"
       (throws? #(design/product {:product/id "p" :product/fulfillment-mode :foo
                                  :parts [] :wall-mm 3})))

;; ── sim ──
(println "sim:")
(check "collision detected"
       (= 1 (count (sim/collisions
                    [{:part/id "a" :part/origin [0 0 0] :part/max-corner [10 10 10]}
                     {:part/id "b" :part/origin [5 0 0] :part/max-corner [15 10 10]}]))))
(check "mounts-on excluded"
       (empty? (sim/collisions
                [{:part/id "a" :part/origin [0 0 0] :part/max-corner [100 100 20] :part/mounts-on nil}
                 {:part/id "b" :part/origin [10 10 2] :part/max-corner [40 40 32] :part/mounts-on "a"}])))
(let [r (sim/insert-path nil
                         {:part/id "b" :part/origin [0 0 20] :part/max-corner [10 10 25]
                          :part/insert-axis :z :part/mounts-on nil}
                         [{:part/id "a" :part/origin [0 0 0] :part/max-corner [10 10 5]}])]
  (check "insert blocked by obstacle" (and (false? (:ok? r)) (= ["a"] (:obstacles r)))))
(let [r (sim/insert-path nil
                         {:part/id "b" :part/origin [0 0 20] :part/max-corner [10 10 25]
                          :part/insert-axis :z :part/mounts-on nil}
                         [{:part/id "a" :part/origin [50 50 0] :part/max-corner [60 60 5]}])]
  (check "insert clear without sweep overlap" (:ok? r)))
(let [{:keys [com mass-g]} (sim/center-of-mass
                            [{:part/id "light" :part/origin [0 0 0] :part/max-corner [10 10 10]
                              :part/mass-g 100 :part/qty 1}
                             {:part/id "heavy" :part/origin [100 0 0] :part/max-corner [110 10 10]
                              :part/mass-g 900 :part/qty 1}])]
  (check "com weighted" (and (= 1000 mass-g) (> (com 0) 50))))

;; ── model: MK-1 sample ──
(println "mk1 model:")
(let [product model/mk1
      r (sim/run-sim product)]
  (check "outer dims [453 173 250]" (= [453 173 250] (:product/outer-dims product)))
  (check "volume ~19.6L" (< 19 (:product/volume-l product) 20))
  (check "mass 3400g" (= 3400 (:product/mass-g product)))
  (check "sim produces findings" (seq (:findings r)))
  (check "sim flags psu insert path"
         (some (fn [f] (and (= :no-insert-path (:kind f)) (= ["psu"] (:parts f)))) (:findings r)))
  (check "sim passed? consistent"
         (= (empty? (:findings r)) (:passed? r))))

;; ── usd ──
(println "usd:")
(let [s (usd/product->usda model/mk1)]
  (check "usda header" (re-find #"#usda 1.0" s))
  (check "metersPerUnit mm" (re-find #"metersPerUnit = 0.001" s))
  (check "all parts exported"
         (every? (fn [p] (re-find (re-pattern (str "def Xform \"" (:part/id p) "\"")) s))
                 (:product/placements model/mk1)))
  (check "mass attribute" (re-find #"massGrams = 3400" s)))

(println)
(if (zero? @failures)
  (println "ALL PASS")
  (do (println @failures " FAILURES") (js/process.exit 1)))
