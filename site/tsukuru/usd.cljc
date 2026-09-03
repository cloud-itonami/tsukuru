(ns tsukuru.usd
  "OpenUSD (usda テキスト) export — NVIDIA 互換の import 境界。
   Isacc Sim / Omniverse がそのまま読める usda を product から出す。
   幾何は AABB box の primitive に落とす (brep kernel が評価する
   厳密 BREP ではなく、sim レベルの envelope — ADR-2607270000 §8 の限界を
   そのまま引き継ぐ)。NVIDIA 側での物理 mesh 化は受け手の責務。")

(defn- esc [s]
  (-> (str s)
      (clojure.string/replace "\\" "\\\\")
      (clojure.string/replace "\"" "\\\"")))

(defn- vec3 [v] (str "(" (clojure.string/join ", " (map (fn [x] (let [n (js/Number. (double x))] (str n))) v)) ")"))

(defn- part-prim [p]
  (let [id (:part/id p)
        org (:part/origin p)
        dims (mapv - (:part/max-corner p) (:part/origin p))
        com (mapv (fn [i] (+ ((:part/origin p) i) (/ (dims i) 2.0))) [0 1 2])]
    (str "    def Xform \"" (esc id) "\"\n"
         "    {\n"
         "        def Cube \"geometry\"\n"
         "        {\n"
         "            float3 xformOp:translate = " (vec3 com) "\n"
         "            float3 xformOp:scale = " (vec3 dims) "\n"
         "            uniform token[] xformOpOrder = [\"xformOp:translate\", \"xformOp:scale\"]\n"
         "        }\n"
         "        double size = 1.0\n"
         "    }\n")))

(defn product->usda
  "product → usda テキスト。stage の単位は mm (metersPerUnit = 0.001)。"
  [{:product/keys [id name placements mass-g] :as product}]
  (let [header (str "#usda 1.0\n"
                    "(\n"
                    "    defaultPrim = \"" (esc id) "\"\n"
                    "    metersPerUnit = 0.001\n"
                    "    upAxis = \"Z\"\n"
                    "    doc = \"tsukuru product " (esc (or name id)) " — AABB envelope export\"\n"
                    ")\n\n"
                    "def Xform \"" (esc id) "\"\n"
                    "{\n"
                    "    custom double massGrams = " (or mass-g 0) "\n")
        body (apply str (map part-prim placements))]
    (str header body "}\n")))

(defn findings->usda-feedback
  "sim findings を custom attribute に載せた usda 注釈ブロック。
   NVIDIA 側 agent が findings を読める形にする。"
  [sim-result]
  (str "# tsukuru.sim findings: " (pr-str (mapv #(select-keys % [:kind :severity :parts])
                                                (:findings sim-result)))
       "\n# passed: " (:passed? sim-result) "\n"))
