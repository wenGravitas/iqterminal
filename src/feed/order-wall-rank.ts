/** Deterministic augmented treap: incremental updates, price-range Top N queries.
 * Subtree price bounds and best (notional, price) prune losers before traversal.
 * No book-wide sort is needed per observation; ties use ascending price. */
export interface RankedLevel { price: number; usd: number }
interface Node extends RankedLevel { quantity:number; sumUsd:number; sumQuantity:number; priority:number; left?:Node; right?:Node; low:number; high:number; best:RankedLevel }
const better=(a:RankedLevel,b:RankedLevel)=>a.usd>b.usd||a.usd===b.usd&&a.price<b.price;
function priority(price:number){let h=2166136261;for(const c of String(price))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
const higher=(a:Node,b:Node)=>a.priority<b.priority||a.priority===b.priority&&a.price<b.price;
function refresh(n:Node){n.sumUsd=(n.left?.sumUsd??0)+n.usd+(n.right?.sumUsd??0);n.sumQuantity=(n.left?.sumQuantity??0)+n.quantity+(n.right?.sumQuantity??0);n.low=n.left?.low??n.price;n.high=n.right?.high??n.price;n.best=n;
 if(n.left&&better(n.left.best,n.best))n.best=n.left.best;
 if(n.right&&better(n.right.best,n.best))n.best=n.right.best;return n;}
function merge(a:Node|undefined,b:Node|undefined):Node|undefined{if(!a)return b;if(!b)return a;
 if(higher(a,b)){a.right=merge(a.right,b);return refresh(a);}b.left=merge(a,b.left);return refresh(b);}
function set(n:Node|undefined,price:number,usd:number,quantity:number):Node|undefined{
 if(!n)return usd>0?{price,usd,quantity,sumUsd:usd,sumQuantity:quantity,priority:priority(price),low:price,high:price,best:{price,usd}}:undefined;
 if(price===n.price){if(usd<=0)return merge(n.left,n.right);n.usd=usd;n.quantity=quantity;return refresh(n);}
 if(price<n.price){n.left=set(n.left,price,usd,quantity);if(n.left&&higher(n.left,n)){const a=n.left;n.left=a.right;a.right=refresh(n);return refresh(a);}}
 else{n.right=set(n.right,price,usd,quantity);if(n.right&&higher(n.right,n)){const a=n.right;n.right=a.left;a.left=refresh(n);return refresh(a);}}
 return refresh(n);
}
export class OrderWallRankIndex {
 private root?:Node;
 readonly metrics={updates:0,queries:0,visited:0};
 set(price:number,usd:number,quantity=0){this.root=set(this.root,price,usd,quantity);this.metrics.updates++;}
 clear(){this.root=undefined;}
 /** Deterministic Cartesian-tree grouping gives the same Float64 sums after
  * checkpoint reordering; it also avoids sorting/summing every bucket member. */
 sum(low:number,high:number,quantity=false):number {
  const visit=(n:Node|undefined):number=>{if(!n||n.high<low||n.low>=high)return 0;
   if(n.low>=low&&n.high<high)return quantity?n.sumQuantity:n.sumUsd;
   return visit(n.left)+(n.price>=low&&n.price<high?(quantity?n.quantity:n.usd):0)+visit(n.right);
  };return visit(this.root);
 }
 /** Price-ordered membership projection, bounded by count; no strength sort. */
 levels(count:number,descending=false):Array<[number,number]>{
  const result:Array<[number,number]>=[];
  const visit=(n:Node|undefined)=>{if(!n||result.length>=count)return;visit(descending?n.right:n.left);if(result.length<count)result.push([n.price,n.quantity]);visit(descending?n.left:n.right);};
  visit(this.root);return result;
 }
 get min(){return this.root?.low;}
 get max(){return this.root?.high;}
 top(count:number,low:number,high:number,minimum=0):RankedLevel[]{
  const result:RankedLevel[]=[];this.metrics.queries++;
  const visit=(n:Node|undefined)=>{
   if(!n||n.high<low||n.low>high||n.best.usd<minimum||result.length===count&&!better(n.best,result[count-1]!))return;
   this.metrics.visited++;
   if(n.price>=low&&n.price<=high&&n.usd>=minimum){const item={price:n.price,usd:n.usd};let i=0;while(i<result.length&&!better(item,result[i]!))i++;result.splice(i,0,item);if(result.length>count)result.pop();}
   const a=n.left,b=n.right;
   if(a&&b&&better(b.best,a.best)){visit(b);visit(a);}else{visit(a);visit(b);}
  };
  if(count>0&&low<=high)visit(this.root);return result;
 }
}
