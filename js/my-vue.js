// 观察者
class Watcher {
  constructor(vm, expr, cb) {
    this.vm = vm;
    this.expr = expr;
    this.cb = cb;
    this.oldVal = this.getOldVal();
  }

  // 获取旧值，即获取初始值(因为在构造器中被调用)
  getOldVal() {
    // 获取旧值之前先把watcher实例放在Dep的targer属性上
    Dep.target = this;
    // 获取旧值时回走到数据劫持中的get方法中，此时当前实例已经被添加到Dep.target属性上，所以可以在get中直接push
    const oldVal = compileUtils.getValue(this.expr, this.vm);
    // 获取完旧值之后，整个构造器中的内容都被放在了Dep属性上，所以要重置才不会影响下一次创建watcher
    Dep.target = null;
    return oldVal;
  }

  // 当观察的值发生变化时
  updater() {
    const newVal = compileUtils.getValue(this.expr, this.vm);
    this.cb(newVal);
  }
}

// 订阅者
class Dep {
  constructor() {
    this.subs = []; // 用于存放所有的观察者
  }

  // 收集观察者
  addSubs(watcher) {
    this.subs.push(watcher);
  }

  // 通知观察者更新视图
  notify() {
    this.subs.forEach(w => w.updater());
  }
}


/**
   * 编译工具类
   *
   * @param {*} node  编译的节点
   * @param {*} expr  编译的值
   * @param {*} vm    实例对象
   * @param {*} eventName  编译绑定的函数名
   */
const compileUtils = {
  text(node, expr, vm) {
    let value;
    // 首先需要判断是 {{}} 表达式还是v-text
    if(expr.indexOf('{{') !== -1) {
      value = expr.replace(/\{\{(.+?)\}\}/g, (...args) => {
        // 这里传进去的args[1]是因为要获取新、旧值要调用，如下return
        new Watcher(vm, args[1], (newVal) => {
          /**
           * callback不用返回值的原因是因为可能只修改了{{person.name}} -- {{person.age}}中的某一个，比如name
           * 而返回值也只返回了被修改的新值，如果使用返回值页面上只有person.name，明显不合理
           * 所以对于重新渲染的新值还是需要根据expr表达式中的每个字段与vm实例对象去一一对应
           * 
           * 而v-model v-html v-text只允许绑定一个，所以直接使用返回值是没有任何问题的
           */
          // this.updater.updaterText(node, newVal);
          this.updater.updaterText(node, this.getNewContentVal(vm, expr));
        });
        // 初步理解为一个节点中可能匹配到多个 {{}} 表达式，所以需要将没个结果返回，并用一个值接收最终总结果
        return this.getValue(args[1], vm);
      })
    } else {
      new Watcher(vm, expr, (newVal) => {
        this.updater.updaterText(node, newVal);
      });
      value = this.getValue(expr, vm);
    }
    this.updater.updaterText(node, value);
  },
  html(node, expr, vm) {
    const value = this.getValue(expr, vm);
    // 编译的时候初始化一个watcher，当watcher被执行更新时，通过回调函数更新
    new Watcher(vm, expr, (newVal) => {
      this.updater.updaterHtml(node, newVal);
    })
    this.updater.updaterHtml(node, value);
  },
  model(node, expr, vm) {
    const value = this.getValue(expr, vm);
    // 编译的时候初始化一个watcher，当watcher被执行更新时，通过回调函数更新

    // 数据驱动视图更新
    new Watcher(vm, expr, (newVal) => {
      this.updater.updaterModel(node, newVal);
    })

    node.addEventListener('input', (e) => {
      this.setValue(expr, vm, e.target.value);
    },false)

    this.updater.updaterModel(node, value);
  },
  on(node, expr, vm, eventName) {
    // 这里的expr代表的仅仅是函数名，并不是函数体，所以要根据名字取出函数体 
    const fn = vm.$options.methods && vm.$options.methods[expr];

    /**
     * eventName 添加的监听的事件名 click
     * 绑定的函数体，因为这里绑定的函数是上面取出的函数体，this指向的当前对象，所以要让this指向实例
     * 当为false时是冒泡排序，否则为事件捕获
     */
    node.addEventListener(eventName, fn.bind(vm), false);
  },

  /**
   * 获取绑定数据的value值
   * 
   * expr有可能是person.friend.name这种格式
   * 首先根据 . 分割再遍历
   * reduce函数中vm.$data作为初始值只想实例的data属性
   * 参数中的data表示上一次的结果，初始值即为vm.$data
   * 第一次遍历：vm.$data[person]
   * 第二次遍历：person.friend ...
   *
   * @param {*} expr
   * @param {*} vm
   * @returns
   */
  getValue(expr, vm) {
    return expr.split('.').reduce((data, current) => {
      return data[current];
    }, vm.$data);
  },
  setValue(expr, vm, inputValue) {
    return expr.split('.').reduce((data, current, index) => {
      /**
       * 当v-model绑定的数据是obj.key.value的格式时，我们只需要改变遍历到滴的值即可
       */
      if(index === expr.split('.').length - 1) {
        data[current] = inputValue;
      }else{
        return data[current];
      }
    }, vm.$data);
  },
  getNewContentVal(vm, expr) {
    return expr.replace(/\{\{(.+?)\}\}/g, (...args) => {
      return this.getValue(args[1], vm);
    })
  },

  // 数据更新视图
  updater: {
    updaterText(node, value) {
      node.textContent = value; // 节点的文本内容为dom.textContent
    },
    updaterHtml(node, value) {
      node.innerHTML = value;
    },
    updaterModel(node, value) {
      node.value = value;
    }
  }
}

// 指令解析器
class Compile {
  constructor(el, vm) {
    this.el = this.isElementNode(el) ? el : document.querySelector(el);
    this.vm = vm;

    // 1. 获取文档碎片对象，放入内存中会减少页面的回流和重绘
    const fragment = this.node2Fragment(this.el);
    
    // 2. 编译模版
    this.compile(fragment);

    // 3. 此时el下的整个dom节点都被存放在文档碎片中，所以需要追加到跟元素下
    this.el.appendChild(fragment);
  }

  // 通过el.nodeType判断是否是dom节点, 是为1，反之undefined
  isElementNode(el) {
    return el.nodeType === 1
  }

  // 将el下的dom全部放到文档碎片中
  node2Fragment(el) {
    // 创建一个文档碎片对象
    let fragment = document.createDocumentFragment();
    let firstChildNode;

    // 取出el的首个子节点赋值后判断是否存在
    while(firstChildNode = el.firstChild) {
      // 如果子节点存在，则存入文档碎片中
      fragment.appendChild(firstChildNode)
    }
    return fragment
  }

  // 编译模版
  compile(fragment) {
    const childNodes = fragment.childNodes;
    [...childNodes].forEach(child => {
      // 1. 判断当前节点类别
      if (this.isElementNode(child)) {
        // 当前节点为dom节点, 编译dom节点
        this.compileElement(child);

      } else {
        // 当前节点为文本节点，编译文本节点
        this.compileText(child);
      }

      // 2. 判断当前节点是否还有子节点
      if(child.childNodes && child.childNodes.length) {
        this.compile(child);
      }
    })
  }

  // 编译节点元素
  compileElement(element) {
    // 获取元素节点属性，dom.attributes
    const attrs = element.attributes;
    [...attrs].forEach(attr => {
      // 每个属性都有name和value,分别代表属性名和属性值
      const {name, value} = attr;

      // 判断属性是否是v-指令属性
      if(this.isDirective(name)) {
        // v-html、v-text、v-model、v-on:click
        const [, directive] = name.split('-');
        // html、text、model、on:click
        const [dirName, eventName] = directive.split(':');

        // 根据不同的指令名称触发不同的函数(编译的节点，编译的值，实例对象，绑定的触发事件)
        compileUtils[dirName](element, value, this.vm, eventName);

        // 指令属性编译结束后移除所有的指令属性(因为这里name代表的是v-指令)
        element.removeAttribute(name);
      }else if(this.isEventName(name)) {
        // 当属性为@event格式时
        const [, eventName] = name.split('@');
        compileUtils['on'](element, value, this.vm, eventName);
        element.removeAttribute(name);
      }
    });
  }

  // 编译文本元素
  compileText(element) {
    const content = element.textContent;
    // 匹配  {{ 除换行符外的任意字符0、1、多次 }}  reg.test(value)
    if(/\{\{(.+?)\}\}/.test(content)) {
      compileUtils['text'](element, content, this.vm);
    }
  }

  isDirective(name) {
    // 判断字符串是否已指定内容开始
    return name.startsWith('v-');
  }

  isEventName(name) {
    return name.startsWith('@');
  }
  
}

// 数据观察器
class Observer {
  constructor(data) {
    this.observer(data);
  }

  // 遍历监听到每一层数据内容
  observer(data) {
    // 先判断监听的数据是否是对象
    if(data && typeof data === 'object') {
      Object.keys(data).forEach(key => {
        this.defineReactive(data, key, data[key]);
      });
    }
  }

  // 对数据进行劫持
  defineReactive(data, key, value) {
    // 递归遍历下一层的数据
    this.observer(value);
    // 创建订阅者
    const dep = new Dep();

    // 劫持 --- 给对象定义新的属性
    Object.defineProperty(data, key, {
      enumerable: true, // 可枚举
      configurable: true, // 可修改
      // 访问当前key的时候直接返回value
      get: () => {
        // 劫持到每一个数据，并把数据的watcher放在dep中
        Dep.target && dep.addSubs(Dep.target);
        return value;
      },
      set: (newValue) => {
        // 首先需要对新赋值的数据进行监听
        this.observer(newValue);
        // 如果传入的新值不等于旧值，则直接将新值赋值给旧值
        if(newValue !== value) {
          value = newValue;
          dep.notify();
        }  
      }
    });
  }
}

// 首先创建一个Vue对象入口
class MVue {
  // 这里接收的options指的是el、data、methods等
  constructor(options) {
    this.$el = options.el;
    this.$data = options.data;
    this.$options = options;

    // 判断el是否有值
    if(this.$el) {
      // 1. 实现一个数据观察者
      new Observer(this.$data);

      // 2. 实现一个指令解析器
      new Compile(this.$el, this);

      // 3. 使用this代理vm.$data
      this.proxyData(this.$data);
    }
    
  }

  proxyData(data) {
    for(const key in data) {
      // 通过数据劫持的方式给每个值添加this属性
      Object.defineProperty(this, key, {
        get() {
          return data[key];
        },
        set(newVal) {
          data[key] = newVal;
        }
      })
    }
  }
}