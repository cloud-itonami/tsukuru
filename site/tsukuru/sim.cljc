(ns tsukuru.sim
  "物理 sim の正本 — AABB 干渉 / 公差 stack-up / 挿入経路 / 質量重心。
   ADR-2607270000 §8 の規律をそのまま引き継ぐ:
   『干渉なし』は『AABB が重ならない』の意味であって、メッシュ精度の
   衝突判定ではない。熱の式は経験式であって CFD ではない。
   この ns は純関数のみ (.cljc)。")

(alias 'design 'tsukuru.design)

;; ── AABB 干渉 ───────────────────────────────────────────────────────────────

(defn- overlap? [a b]
  (every? pos? (map (fn [amin amax bmin bmax]
                      (min (- amax bmin) (- bmax amin)))
                    (:part/origin a) (:part/max-corner a)
                    (:part/origin b) (:part/max-corner b))))

(defn collisions
  "配置済み部材の AABB 相互干渉。嵌合親子 (:part/mounts-on) は除外。
   戻り値は [{:colliding [id-a id-b] ...}] — 空なら干渉なし。"
  [placed]
  (let [pairs (for [a placed b placed
                    :while (not= (:part/id a) (:part/id b))
                    :when (pos? (compare (:part/id a) (:part/id b)))
                    :let [parent-a (:part/mounts-on a)
                          parent-b (:part/mounts-on b)
                          related? (or (= parent-a (:part/id b))
                                       (= parent-b (:part/id a))
                                       (and parent-a (= parent-a parent-b)))]
                    :when (and (not related?) (overlap? a b))]
                {:colliding [(:part/id a) (:part/id b)]
                 :severity :error
                 :kind :aabb-intersection})]
    (vec (distinct pairs))))

;; ── 公差 stack-up ───────────────────────────────────────────────────────────

(defn tolerance-stack
  "内寸の worst-case stack-up。各部材の公差 grade (IT grade → mm) を軸ごとに
   積算し、外寸の上限を評価する。:inner-dims + Σtolerance が :outer-dims を
   超えたら設計は成立しない。
   grades: {:fit 0.05 :standard 0.2 :loose 0.5} (mm、片側)。"
  [{:design/keys [hull] :as product} grades]
  (let [g (merge {:fit 0.05 :standard 0.2 :loose 0.5} grades)
        per-part (map (fn [p] (g (get p :part/fit-class :standard))) (:product/bom product))
        n (count per-part)
        stack-x (* n (:standard g))
        inner (:inner-dims hull)
        outer (:outer-dims hull)]
    {:tolerance/per-part-mm (g :standard)
     :tolerance/parts n
     :tolerance/stack-mm [stack-x stack-x stack-x]
     :tolerance/worst-inner [(- (inner 0) stack-x) (- (inner 1) stack-x) (- (inner 2) stack-x)]
     :tolerance/ok? (every? true? (map (fn [w o] (<= w o))
                                       (:tolerance/worst-inner {:tolerance/worst-inner (mapv - inner [stack-x stack-x stack-x])})
                                       outer))}))

(defn tolerance-check
  "public API: 製品の公差成立判定。{ok? violations} を返す。"
  [product]
  (let [{:keys [tolerance/ok?]} (tolerance-stack product nil)]
    {:ok? ok?
     :violations (if ok? [] [{:kind :tolerance-stack-exceeded :severity :error}])}))

;; ── 挿入経路 ────────────────────────────────────────────────────────────────

(defn insert-path
  "部材 b を挿入軸に沿って無限遠から目標位置まで掃引したとき、既設部材と
   当たるか。嵌合親は除外。:part/insert-axis :none の部材 (bench 先組みの
   subassembly 構成員) は挿入検査の対象外。
   さらに「先に付けた subassembly 構成員を障害に数えない」: bench 先組みの
   部材 (:none) は挿入対象部材の障害にならない (それらは mobo と一体として
   先に存在するので、後から挿入する部材の掃引帯を評価するときのみ障害になる。
   実装上は: 挿入対象同士だけを互いの障害にする)。
   戻り値: {:ok? obstacles}。"
  [placed target other-parts]
  (let [axis (:part/insert-axis target)]
    (if (or (nil? axis) (= axis :none))
      {:ok? true :obstacles []}
      (let [ai (get {:x 0 :y 1 :z 2} axis)
            blocking (fn [o]
                       (and
                        ;; subassembly 構成員 (:none) は障害にしない
                        (not (#{nil :none} (:part/insert-axis o)))
                        (not (or (= (:part/mounts-on target) (:part/id o))
                                 (= (:part/mounts-on o) (:part/id target))))
                        (let [others (disj (set (range 3)) ai)]
                          (and (every? (fn [d]
                                         (let [[a0 a1] [((:part/origin target) d) ((:part/max-corner target) d)]
                                               [b0 b1] [((:part/origin o) d) ((:part/max-corner o) d)]]
                                           (< (max a0 b0) (min a1 b1))))
                                       others)
                               (< ((:part/origin o) ai) ((:part/origin target) ai))))))
            blocked (filter blocking other-parts)]
        {:ok? (empty? blocked)
         :obstacles (mapv :part/id blocked)}))))

(defn insert-paths
  "全部材の挿入経路を検査する。失敗した部材の一覧を返す。"
  [placed]
  (->> placed
       (map (fn [t]
              (let [others (remove #(= (:part/id %) (:part/id t)) placed)
                    r (insert-path placed t others)]
                (when-not (:ok? r)
                  {:part (:part/id t)
                   :axis (:part/insert-axis t)
                   :obstacles (:obstacles r)}))))
       (remove nil?)
       vec))

;; ── 質量重心 ────────────────────────────────────────────────────────────────

(defn center-of-mass
  "質量重心 (mm)。mass 0 の部材は重心計算から外す (体積 0 の点と同じ扱い)。"
  [placed]
  (let [weighted (filter (fn [p] (pos? (or (:part/mass-g p) 0))) placed)
        m (reduce + 0 (map (fn [p] (* (:part/mass-g p) (or (:part/qty p) 1))) weighted))]
    (if (zero? m)
      {:com nil :mass-g 0}
      (let [c (mapv (fn [i]
                      (/ (reduce + 0 (map (fn [p]
                                            (* (:part/mass-g p) (or (:part/qty p) 1)
                                               (+ ((:part/origin p) i)
                                                  (/ ((:part/max-corner p) i) 2))))
                                          weighted))
                         m))
                    [0 1 2])]
        {:com c :mass-g m}))))

;; ── 総合判定 ────────────────────────────────────────────────────────────────

(defn run-sim
  "product の sim を通す。戻り値は findings のリスト (空 = 合格)。
   findings は {kind severity parts note}。"
  [product]
  (let [placed (:product/placements product)
        coll (collisions placed)
        tol (tolerance-check product)
        ins (insert-paths placed)
        {:keys [com mass-g]} (center-of-mass placed)]
    {:findings (vec (concat coll
                            (:violations tol)
                            (map (fn [f] {:kind :no-insert-path
                                          :severity :error
                                          :parts [(:part f)]
                                          :note (str "blocked by " (pr-str (:obstacles f))
                                                      " on axis " (:axis f))})
                                 ins)))
     :com com
     :mass-g mass-g
     :passed? (and (empty? coll) (:ok? tol) (empty? ins))}))
