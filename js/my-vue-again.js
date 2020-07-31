const complieUtils = {
  getVal(expr, vm) {
    return expr.split('.').reduce((data, currData) => {
      return data[currData];
    }, vm.$data);
  },
  setVal(expr, vm, newVal) {
    expr.split('.').reduce((data, currData, index) => {
      // 只有遍历到最后一个属性时才开始进行赋值，否则就做累加
      if (index === expr.split('.').length - 1) {
        data[currData] = newVal;
      } else {
        return data[currData];
      }
    }, vm.$data);
  },
  getTextContent(expr, vm) {
    return expr.replace(/\{\{(.+?)\}\}/g, (...args) => {
      return this.getVal(args[1], vm);
    })
  },
  text(node, expr, vm) {
    let value;
    if(expr.indexOf('{{') !== -1) {
      // 正则表达式替换方法是： string.replace(RegExp, cb)
      value = expr.replace(/\{\{(.+?)\}\}/g, (...args) => {
        /**
         * 这里是处理文本---双括号表达式部分
         * 因为考虑到文本内容可能是 {{person.name}} --- {{person.age}} --- {{person.decs}}这种格式
         * 我们遍历首先会将person.name表达式传进去，并返回新值
         * 如果这里直接用返回的新值，会覆盖掉person.age 和 person.desc等的值
         * 所以这里观察到数据发生变化并更新视图的时候
         * 需要重新根据整个文本获取到完整的结果内容，添加到网页中
         * 
         * 下面只是为了符合程序的逻辑，传入的前两个参数没有任何价值和作用
         */
        new Watcher(args[1], vm, () => {
          this.updater.updaterText(node, this.getTextContent(expr, vm));
        })
        return this.getVal(args[1], vm)
      });
    }else{
      new Watcher(expr, vm, (newVal) => {
        this.updater.updaterText(node, newVal);
      })
      value = this.getVal(expr, vm);
    }
    this.updater.updaterText(node, value);
  },
  html(node, expr, vm) {
    const value = this.getVal(expr, vm);
    new Watcher(expr, vm, (newVal) => {
      this.updater.updaterHtml(node, newVal);
    })
    this.updater.updaterHtml(node, value);
  },
  model(node, expr, vm) {
    const value = this.getVal(expr, vm);
    new Watcher(expr, vm, (newVal) => {
      this.updater.updaterModel(node, newVal);
    })

    // model数据双向绑定使用过给节点监听input事件，获取到输入框中的值，然后找到v-model表达式指定的属性，修改
    node.addEventListener('input', (e) => {
      this.setVal(expr, vm, e.target.value);
    }, false);

    this.updater.updaterModel(node, value);
  },
  on(node, expr, vm, eventType) {
    const eventBody = vm.$options.methods && vm.$options.methods[expr];
    // 给node节点绑定一个事件监听，
    // 第一个参数代表出发函数方式类型，
    // 第二个函数是函数体，这里使用bind是将当前作用域指向vm，因为call和apply会立即执行
    // 第三个是阻止事件冒泡
    node.addEventListener(eventType, eventBody.bind(vm), false);
  },
  updater: {
    updaterText(node, value) {
      node.textContent = value;
    },
    updaterHtml(node, value) {
      node.innerHTML = value;
    },
    updaterModel(node, value) {
      node.value = value;
    }
  }
}

// 观察者，观察数据的新旧变化，当数据发生改变时，执行回调
class Watcher {
  // 因为观察者要通过回调函数将改变后的新值更新，所以需要获取新值，即参数是如下
  constructor(expr, vm, cb) {
    this.expr = expr;
    this.vm = vm;
    this.cb = cb;

    this.oldVal = this.getOldVal();
  }

  getOldVal() {
    // 每劫持到一个数据就会产生对应的观察者，所以将当前的观察者实例绑定到Dep的target属性上，方便关联
    Dep.target = this;
    const oldVal = complieUtils.getVal(this.expr, this.vm);
    Dep.target = null;
    return oldVal;
  }

  updater() {
    // 当通知观察者作出相应的回调函数时，数据已经在数据劫持环节更新了，所以只需要根据表达式取出更新的值，并返回
    const newVal = complieUtils.getVal(this.expr, this.vm);
    this.cb(newVal);
  }
}

// 订阅者，主要用于收集所有的观察者，当Observer类监听到数据发生变化时通知订阅者发布消息给观察者
class Dep {
  constructor() {
    this.subs = [];
  }

  addWatcher(watcher) {
    this.subs.push(watcher);
  }

  notify() {
    this.subs.forEach(w => w.updater());
  }
}

// Observer类的作用就是对data中的所有属性进行劫持监听
class Observer {
  constructor(data) {
    this.observer(data);
  }

  // 递归遍历取出每一层的属性
  observer(data) {
    if(data && typeof data === 'object') {
      Object.keys(data).forEach(key => {
        this.defineReactive(data, key, data[key]);
      })
    }
  }

  // 对取出的数据进行数据劫持
  defineReactive(data, key, value) {
    this.observer(value);

    const dep = new Dep();

    Object.defineProperty(data, key, {
      // en`niu`me`ruo`bol
      enumerable: true, 
      configurable: true,
      get: () => {
        // 在劫持到每个属性的时候，就将该属性的观察者添加到订阅者中
        Dep.target && dep.addWatcher(Dep.target);
        return value;
      },
      set: (newVal) => {
        if(newVal !== value) {
          this.observer(newVal);
          value = newVal;

          // 当数据发生改变时，告诉订阅者通知观察者作出相应的回调
          dep.notify()
        }
      }
    })
  }
}

class Complie {
  constructor(el, expr, vm) {
    // 判断绑定的节点时节点树还是字符串
    this.el = this.isElementNode(el) ? el : document.querySelector(el);
    this.expr = expr;
    this.vm = vm;

    // 获取绑定的节点下的所有子元素，并放在文档碎片中，目的是减少数据改变引发的重回或回流，优化项目
    const fragments = this.elementToFragment(this.el);

    // 编译文档碎片
    this.complie(fragments);
    
    // 将整个文档碎片放入节点中
    this.el.appendChild(fragments);
  }

  // 判断一个节点是否是dom节点时，只需看它的nodeType属性是否等于一
  isElementNode(node) {
    return node.nodeType === 1;
  }

  // dom节点转换为文档碎片
  elementToFragment(node) {
    const fragment = document.createDocumentFragment();
    let childNode;
    // 通过node.firstChild属性来获取节点下的每一个子节点
    while (childNode = node.firstChild) {
      fragment.appendChild(childNode);
    }
    return fragment;
  }

  // 编译
  complie(fragment) {
    // 这里的fragment代表的时整个dom对象，操作时还需要取到所有的子元素
    const childNodes = fragment.childNodes;
    // 遍历每一层节点
    [...childNodes].forEach(child => {
      if(this.isElementNode(child)) {
        // 编译 -- 节点元素
        this.complieDocumentElement(child);
      }else {
        // 编译 -- 文本元素
        this.complieTextElement(child);
      }
  
      // 通过递归的方式遍历下一层节点
      if(child.childNodes && child.childNodes.length) {
        this.complie(child);
      }
    })
  }

  // 编译dom节点
  complieDocumentElement(node) {
    // 进入dom节点编译方法中，就需要对当前节点的所有属性进行解析
    const attrs = node.attributes;
    [...attrs].forEach(attribute => {
      const {name, value} = attribute;
      if(this.isDirective(name)){
        const [, directive] = name.split('-');
        const [directiveName, eventType] = directive.split(':');
        // 执行指令对应的函数，参数传入操作的节点、渲染的表达式、整个对象、 事件名
        complieUtils[directiveName](node, value, this.vm, eventType);
        node.removeAttribute(name)
      }else if (this.isEventDirective(name)) {
        const [, eventType] = name.split('@');
        complieUtils['on'](node, value, this.vm, eventType);
        node.removeAttribute(name)
      }
    })
  }

  // 编译文本节点
  complieTextElement(node) {
    const value = node.textContent;
    // 只有文本内容是{{}}表达式时才需要编译
    if(/\{\{(.+?)\}\}/.test(value)) {
      complieUtils['text'](node, value, this.vm);
    }
  }

  // 是否是指令
  isDirective(attr) {
    return attr.startsWith('v-');
  }

  isEventDirective(name) {
    return name.startsWith('@');
  }
}

class MVue {
  constructor(options) {
    this.$el = options.el;
    this.$data = options.data;
    this.$options = options;

    // 只有传入了el时才会执行，否则没必要继续执行下去
    if(this.$el) {
      // 1. 数据劫持，observer
      new Observer(this.$data);

      // 2. 编译模版 complie
      new Complie(this.$el, this.$data, this);

      // 3. 代理this
      this.proxyData(this.$data);
    }
  }

  proxyData(data) {
    /**
     * 作用是将vm.$data上所有属性都映射到this上
     * 这里只需要将data对象中第一层数据映射到this中即可，内层的也可以通过this调用
     */
      Object.keys(data).forEach(key => {
        Object.defineProperty(this, key, {
          get: () => {
            return data[key];
          },
          set: (newVal) => {
            if(newVal !== data[key]) {
              data[key] = newVal;
            }
          }
        })
      })
  }
}