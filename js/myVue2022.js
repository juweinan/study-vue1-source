const CompilerUtils = {
  getValue(expr, vm) {
    return expr.split('.').reduce((value, curr) => value[curr.trim()], vm.$data);
  },
  setValue(expr, vm, newValue) {
    expr.split('.').reduce((value, curr, index) => {
      // 只有找到深层中对应的属性，才进行赋值操作，否则就一直找下去
      if (index === expr.split('.').length - 1) {
        value[curr.trim()] = newValue;
      } else {
        return value[curr.trim()];
      }
    }, vm.$data);
  },
  text(node, expr, vm) {
    if (/\{\{(.+?)\}\}/.test(expr)) {
      // {{ }} 语法
      node.textContent = expr.replace(/\{\{(.+?)\}\}/g, (_, subExpr) => {
        // {{ person.name }} --- {{ person.age }}
        // watcher 需要对每个属性表达式进行观察，而非观察整个表达式
        new Watcher(subExpr, vm, () => {
          node.textContent = expr.replace(/\{\{(.+?)\}\}/g, (_, subExpr) =>
            this.getValue(subExpr, vm)
          );
        });
        return this.getValue(subExpr, vm);
      });
    } else {
      // v-text
      new Watcher(expr, vm, (newValue) => {
        node.textContent = newValue;
      });
      node.textContent = this.getValue(expr, vm);
    }
  },
  html(node, expr, vm) {
    new Watcher(expr, vm, (newValue) => {
      node.innerHTML = newValue;
    });
    node.innerHTML = this.getValue(expr, vm);
  },
  model(node, expr, vm) {
    new Watcher(expr, vm, (newValue) => {
      node.value = newValue;
    });
    // 监听输入框 input 事件，当修改输入框内容时，重新设置 data
    node.addEventListener('input', (e) => {
      this.setValue(expr, vm, e.target.value);
    });
    node.value = this.getValue(expr, vm);
  },
  bind(node, expr, vm, attrName) {
    new Watcher(expr, vm, (newValue) => {
      node.setAttribute(attrName, newValue);
    });
    node.setAttribute(attrName, this.getValue(expr, vm));
  },
  on(node, expr, vm, eventName) {
    node.addEventListener(eventName, vm.$options?.methods?.[expr]?.bind(vm));
  },
};

class Compiler {
  constructor(el, vm) {
    this.el = this.isElement(el) ? el : document.querySelector(el);
    this.vm = vm;

    // 1. 将 el 的全部子元素放入 fragment 中
    const fragment = this.node2Fragment(this.el);

    // 2. 开始编译 fragment
    this.compile(fragment);

    // 3. 插入到 el 中
    this.el.appendChild(fragment);
  }

  compile(node) {
    [...node.childNodes].forEach((child) => {
      this.isElement(child)
        ? this.compileElement(child) // 元素节点
        : this.compileText(child); // 文本节点

      child?.childNodes?.length && this.compile(child);
    });
  }

  compileElement(node) {
    [...node.attributes].forEach((attr) => {
      const { name, value } = attr;
      if (this.isDirective(name)) {
        let directName, bindTarget;

        if (name.startsWith(':')) {
          directName = 'bind';
          bindTarget = name.slice(1);
        } else if (name.startsWith('@')) {
          directName = 'on';
          bindTarget = name.slice(1);
        } else {
          const [, directive] = name.split('-');
          [directName, bindTarget] = directive.split(':');
        }

        CompilerUtils[directName](node, value, this.vm, bindTarget);
        // 当前判断条件中的属性一定是指令，因此需要移除指令
        node.removeAttribute(name);
      }
    });
  }

  compileText(node) {
    const content = node.textContent;
    if (/\{\{(.+?)\}\}/.test(content)) {
      CompilerUtils['text'](node, content, this.vm);
    }
  }

  isElement(node) {
    return node.nodeType === 1;
  }

  isDirective(attrName) {
    return attrName.startsWith('v-') || attrName.startsWith(':') || attrName.startsWith('@');
  }

  node2Fragment(node) {
    const f = document.createDocumentFragment();
    let currentNode;

    while ((currentNode = node.firstChild)) {
      f.appendChild(currentNode);
    }

    return f;
  }
}

class Observer {
  constructor(obj) {
    this.observe(obj);
  }

  observe(obj) {
    // 对于对象类型的数据的每个属性都进行数据劫持
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach((key) => {
        this.defineReactive(obj, key, obj[key]);
      });
    }
  }

  defineReactive(obj, key, value) {
    this.observe(value);
    const dep = new Dep();
    Object.defineProperty(obj, key, {
      get() {
        Dep.target && dep.depend(Dep.target);
        return value;
      },
      set: (newValue) => {
        if (newValue !== value) {
          this.observe(newValue);
          value = newValue;
          dep.notify();
        }
      },
    });
  }
}

class Dep {
  constructor() {
    this.subs = [];
  }

  depend(watcher) {
    this.subs.push(watcher);
  }

  notify() {
    this.subs.forEach((w) => w.update());
  }
}

class Watcher {
  constructor(expr, vm, cb) {
    this.expr = expr;
    this.vm = vm;
    this.cb = cb;
    this.getOldV();
  }

  // 该方法只有在初始化 watcher 的时候会执行一次
  getOldV() {
    // 因此 Dep.target 也只会赋值一次
    Dep.target = this;
    // 只有在初始化，访问属性值的时候，Dep.target 才有值，才会收集依赖
    CompilerUtils.getValue(this.expr, this.vm);
    // 收集完之后，就清空，这样等到以后任何位置，任何情况访问的时候，都不会对于当前属性重复收集依赖了
    Dep.target = null;
  }

  update() {
    // 比如，这里更新的时候会拿到属性最新的值，如果上面的 Dep.target 不清空，那么又会收集一次依赖
    this.cb(CompilerUtils.getValue(this.expr, this.vm));
  }
}

class MyVue {
  constructor(options) {
    this.$el = options.el;
    this.$data = options.data;
    this.$options = options;

    if (this.$el) {
      // 劫持数据
      new Observer(this.$data);
      // 编译模板
      new Compiler(this.$el, this);
    }
  }
}
