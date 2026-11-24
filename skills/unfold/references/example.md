# 一个例子：讲一节就够味

下面是「注意力机制为什么能并行」这一节的写法。注意标题、句子长度、引用与讲稿的配合。

```json
{
  "id": "s3",
  "level": 1,
  "title": "注意力能并行，是因为它不依赖上一步的输出",
  "summary": "循环网络把计算串成一条链；注意力把整句话同时摊开，用点积一次算完。",
  "blocks": [
    {
      "id": "b7",
      "kind": "p",
      "md": "先看循环网络的问题。它每一步都要用上一步的隐藏状态 $h_{t-1}$，所以第 5 个词一定要等前 4 个词算完。这不是实现上的选择，是结构决定的。",
      "cites": [
        { "doc": "p1", "page": 2, "quote": "This inherently sequential nature precludes parallelization within training examples, which becomes critical at longer sequence lengths, as memory constraints limit batching across examples." }
      ]
    },
    {
      "id": "b8",
      "kind": "key",
      "md": "**注意力换掉了这条链**：它让每个词同时和句子里所有词算一次相关度，所有位置的结果互不依赖，可以一次算完。",
      "cites": [
        { "doc": "p1", "page": 2, "quote": "Attention mechanisms have become an integral part of compelling sequence modeling and transduction models in various tasks, allowing modeling of dependencies without regard to their distance in the input or output sequences" }
      ]
    },
    {
      "id": "b9",
      "kind": "def",
      "md": "**自注意力（self-attention）**：一句话里的每个位置，分别和同一句话的所有位置算相关度，再按相关度加权求和。因为所有位置的地位一样，没有「谁必须等谁」。",
      "note": "这里的「相关度」就是两个向量的点积——第 4 节给公式。"
    }
  ]
}
```

配套的讲课节拍：

```json
[
  { "block": "b7", "say": "循环网络慢，不是写得不好，是结构上就必须一个一个来。" },
  { "block": "b8", "say": "注意力把这个链条剪断了：整句话摊开，每个词同时看所有词。", "point": true },
  { "block": "b9", "say": "这就是自注意力，注意它没有「上一步」这个概念，所以能并行。" }
]
```

## 反例（别这么写）

```json
{
  "title": "注意力机制介绍",
  "md": "近年来，注意力机制在自然语言处理领域受到了广泛关注。本文提出了一种基于注意力的模型……"
}
```

问题：标题是话题不是结论；「近年来……广泛关注」是综述腔，删掉不影响任何信息；
「本文提出了一种模型」是文献报告，不是讲课。

## 再一个反例：引用

```json
{ "doc": "p1", "page": 2, "quote": "Attention is a mechanism that helps models focus on relevant parts..." }
```

问题：这不是原文，是转述。定位会失败，读者也看不到原页。正确做法是先
`unfold_search { query: "Attention mechanisms have become" }`，拿到页号和原句再粘。
