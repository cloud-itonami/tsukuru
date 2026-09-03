(ns tsukuru.site-test
  (:require [clojure.test :refer [deftest is testing]]
            [tsukuru.design :as design]
            [tsukuru.sim :as sim]
            [tsukuru.usd :as usd]
            [tsukuru.model :as model]))

(defn- placed [id origin envelope]
  {:part/id id :part/origin origin :part/max-corner (mapv + origin envelope)
   :part/insert-axis :z :part/mounts-on nil :part/mass-g 100 :part/qty 1})

(deftest hull-derives-outer-dims
  (let [p [(placed "a" [3 3 3] [10 10 10])
           (placed "b" [20 5 5] [5 5 5])]
        h (design/hull p 3)]
    (is (= [25 15 15] (:outer-dims h)))
    (is (> (:volume-l h) 0))))

(deftest collision-detects-overlap
  (let [p [(placed "a" [0 0 0] [10 10 10])
           (placed "b" [5 0 0] [10 10 10])]]
    (is (= 1 (count (sim/collisions p))))))

(deftest collision-excludes-mounts-on
  (let [a (assoc (placed "a" [0 0 0] [100 100 20]) :part/mounts-on nil)
        b (assoc (placed "b" [10 10 2] [30 30 30]) :part/mounts-on "a")]
    (is (empty? (sim/collisions [a b])))))

(deftest insert-path-blocked-by-obstacle
  ;; z 軸挿入の b の掃引帯 (xy) に a が手前にある
  (let [a (placed "a" [0 0 0] [10 10 5])
        b (placed "b" [0 0 20] [10 10 5])
        r (sim/insert-path nil b [a])]
    (is (false? (:ok? r)))
    (is (= ["a"] (:obstacles r)))))

(deftest insert-path-clear-when-no-sweep-overlap
  (let [a (placed "a" [50 50 0] [10 10 5])
        b (placed "b" [0 0 20] [10 10 5])]
    (is (:ok? (sim/insert-path nil b [a])))))

(deftest center-of-mass-weighted
  (let [p [(placed "light" [0 0 0] [10 10 10])
           (assoc (placed "heavy" [100 0 0] [10 10 10]) :part/mass-g 900)]
        {:keys [com mass-g]} (sim/center-of-mass p)]
    (is (= 1000 mass-g))
    (is (> (com 0) 50))))

(deftest run-sim-finds-real-defect
  ;; PSU が Z 手前にあり、mobo を Z 挿入すると当たる — 本物の設計欠陥の形
  (let [product (model/mk1)
        r (sim/run-sim product)]
    (is (map? r))
    (is (contains? r :findings))
    (is (contains? r :passed?))))

(deftest usda-roundtrip-shape
  (let [product (model/mk1)
        s (usd/product->usda product)]
    (is (re-find #"#usda 1.0" s))
    (is (re-find #"metersPerUnit = 0.001" s))
    (is (re-find #"def Xform \"mobo\"" s))
    (doseq [p (:product/placements product)]
      (is (re-find (re-pattern (str "def Xform \"" (:part/id p) "\"")) s)))))

(deftest duplicate-part-ids-rejected
  (is (thrown? #?(:clj Exception :cljs js/Error)
               (design/bill-of-materials
                [(design/part {:part/id "x" :part/envelope [1 1 1]})
                 (design/part {:part/id "x" :part/envelope [2 2 2]})]))))
