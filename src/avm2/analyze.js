var Control = (function () {

  function formatBlock(block) {
    return "#" + block.blockId;
  }

  var TraceLeave = {
    trace: function (writer) {
      writer.leave("}");
    }
  };

  function Clusterfuck(body) {
    this.body = body;
  }

  Clusterfuck.prototype = {
    trace: function (writer, worklist) {
      writer.writeLn("clusterfuck " + formatBlock(this.body));
    }
  };

  function Seq(body, exit) {
    this.body = body;
    this.exit = exit;
  }

  Seq.prototype = {
    trace: function (writer, worklist) {
      writer.writeLn(formatBlock(this.body));
      this.exit && worklist.push(this.exit);
    }
  };

  function Loop(body, exit) {
    this.body = body;
    this.exit = exit;
  }

  Loop.prototype = {
    trace: function (writer, worklist) {
      writer.enter("loop {");
      this.exit && worklist.push(this.exit);
      worklist.push(TraceLeave);
      worklist.push(this.body);
    }
  };

  function If(cond, then, els, negated, exit) {
    this.cond = cond;
    this.then = then;
    this.else = els;
    this.negated = negated;
    this.exit = exit;
  }

  var TraceElse = {
    trace: function (writer) {
      writer.outdent();
      writer.enter("} else {");
    }
  };

  If.prototype = {
    trace: function (writer, worklist) {
      writer.writeLn(formatBlock(this.cond));
      writer.enter("if" + (this.negated ? " not" : "") + " {");
      this.exit && worklist.push(this.exit);
      worklist.push(TraceLeave);
      if (this.else) {
        worklist.push(TraceElse);
        worklist.push(this.else);
      }
      worklist.push(this.then);
    }
  };

  function LabeledBreak(target) {
    this.target = target;
  }

  LabeledBreak.prototype = {
    trace: function (writer) {
      writer.writeLn("break to " + formatBlock(this.target));
    }
  };

  function LabeledContinue(target) {
    this.target = target;
  }

  LabeledContinue.prototype = {
    trace: function (writer) {
      writer.writeLn("continue to " + formatBlock(this.target));
    }
  };

  function nullaryControl(name) {
    var c = {};
    c.trace = function (writer) {
      writer.writeLn(name);
    }
    return c;
  };

  var Break = nullaryControl("break");
  var Continue = nullaryControl("continue");
  var Return = nullaryControl("return");

  return {
    Clusterfuck: Clusterfuck,
    Seq: Seq,
    Loop: Loop,
    If: If,
    LabeledBreak: LabeledBreak,
    LabeledContinue: LabeledContinue,
    Break: Break,
    Continue: Continue,
    Return: Return
  };

})();

var Bytecode = (function () {

  function Bytecode(code) {
    var op = code.readU8();
    this.op = op;

    var i, n;

    switch (op) {
    case OP_lookupswitch:
      /* offsets[0] is the default offset. */
      this.offsets = [code.readS24()];
      var n = code.readU30() + 1;
      for (i = 0; i < n; i++) {
        this.offsets.push(code.readS24());
      }
      break;
    default:
      var opdesc = opcodeTable[op];
      if (!opdesc) {
        unexpected("Unknown Op " + op);
      }

      for (i = 0, n = opdesc.operands.length; i < n; i++) {
        var operand = opdesc.operands[i];

        switch (operand.size) {
        case "u08":
          this[operand.name] = code.readU8();
          break;
        case "s16":
          this[operand.name] = code.readU30Unsafe();
          break;
        case "s24":
          this[operand.name] = code.readS24();
          break;
        case "u30":
          this[operand.name] = code.readU30();
          break;
        case "u32":
          this[operand.name] = code.readU32();
          break;
        default:
          unexpected();
        }
      }
    }
  }

  var Bp = Bytecode.prototype;

  Bp.makeBlockHead = function makeBlockHead() {
    if (this.succs) {
      return;
    }

    this.succs = [];
    this.preds = [];
  };

  Bp.makeLoopHead = function makeLoopHead(backEdge) {
    if (this.loop && this.loop.has(backEdge) >= 0) {
      return;
    }

    var body = new BytecodeSet([this]);
    var pending = [backEdge];
    var p;
    while (p = pending.pop()) {
      if (!body.has(p)) {
        p.inLoop = this;
        body.add(p);
        pending.push.apply(pending, p.preds);
      }
    }

    body.takeSnapshot();
    this.loop = body;
  }

  Bp.doubleLink = function doubleLink(target) {
    assert(this.succs);
    this.succs.push(target);
    target.preds.push(this);
  };

  Bp.leadsTo = function leadsTo(target) {
    return ((this === target) ||
            (this.frontier.size === 1) &&
            (this.frontier.snapshot[0] === target));
  };

  /* Find the dominator set from immediate dominators. */
  function dom() {
    assert(this.succs);
    assert(this.dominator);

    var b = this;
    var d = new BytecodeSet([b]);
    do {
      d.add(b.dominator);
      b = b.dominator;
    } while (b !== b.dominator);

    Object.defineProperty(this, "dom", { value: d,
                                         configurable: true,
                                         enumerable: true });
    return d;
  }
  Object.defineProperty(Bp, "dom", { get: dom,
                                     configurable: true,
                                     enumerable: true });

  Bp.toString = function toString() {
    var opdesc = opcodeTable[this.op];
    var str = opdesc.name.padRight(' ', 20);
    var i, j;

    if (this.op === OP_lookupswitch) {
      str += "defaultTarget:" + this.targets[0].position;
      for (i = 1, j = this.offsets.length; i < j; i++) {
        str += ", target:" + this.targets[i].position;
      }
    } else {
      for (i = 0, j = opdesc.operands.length; i < j; i++) {
        var operand = opdesc.operands[i];

        if (operand.name === "offset") {
          str += "target:" + this.target.position;
        } else {
          str += operand.name + ":" + this[operand.name];
        }

        if (i < j - 1) {
          str += ", ";
        }
      }
    }

    return str;
  };

  return Bytecode;

})();

/*
 * It's only sane to use this data structure for bytecodes within the same
 * bytecode stream, since positions are used as keys.
 */
var BytecodeSet = (function () {

  function hasOwn(obj, name) {
    return Object.hasOwnProperty.call(obj, name);
  }

  function BytecodeSet(init) {
    var backing = Object.create(null, {});
    if (init) {
      for (var i = 0, j = init.length; i < j; i++) {
        backing[init[i].position] = init[i];
      }
    }
    this.backing = backing;
    this.size = init ? init.length : 0;
  }

  BytecodeSet.prototype = {
    has: function (x) {
      return hasOwn(this.backing, x.position);
    },

    add: function (x) {
      if (!hasOwn(this.backing, x.position)) {
        this.backing[x.position] = x;
        this.size++;
      }
    },

    remove: function (x) {
      if (hasOwn(this.backing, x.position)) {
        delete this.backing[x.position];
        this.size--;
      }
    },

    unionArray: function (arr) {
      var backing = this.backing;
      for (var i = 0, j = arr.length; i < j; i++) {
        var position = arr[i].position;
        if (!hasOwn(backing, position)) {
          this.size++;
        }
        backing[position] = arr[i];
      }
    },

    union: function (other) {
      var otherBacking = other.backing;
      var backing = this.backing;
      for (var position in otherBacking) {
        if (!hasOwn(backing, position)) {
          this.size++;
        }
        backing[position] = otherBacking[position];
      }
    },

    difference: function (other) {
      var otherBacking = other.backing;
      var backing = this.backing;
      for (var position in otherBacking) {
        if (hasOwn(backing, position)) {
          delete backing[position];
          this.size--;
        }
      }
    },

    /*
     * If the set has a snapshot, assume it's current and use that to choose
     * an element. Otherwise choose a key and resolve it.
     *
     * NB: It's up to the user to make sure this is not stale before using!
     */
    choose: function () {
      if (this.snapshot) {
        return this.snapshot.top();
      }

      var backing = this.backing;
      return backing[Object.keys(backing)[0]];
    },

    /*
     * Snapshot current state into an array for iteration.
     *
     * NB: It's up to the user to make sure this is not stale before using!
     */
    takeSnapshot: function () {
      var n = this.size;
      var a = new Array(n);
      var i = 0;
      var backing = this.backing;
      for (var position in backing) {
        a[i++] = backing[position];
      }
      this.snapshot = a;
    }
  };

  return BytecodeSet;

})();

var Analysis = (function () {

  function dfs(root, pre, post, succ) {
    var visited = {};
    var pended = {};
    var worklist = [root];
    var node;

    pended[root.position] = true;
    while (node = worklist.top()) {
      if (!visited[node.position]) {
        visited[node.position] = true;

        if (pre) {
          pre(node);
        }
      } else {
        if (post) {
          post(node);
        }
        worklist.pop();
        continue;
      }

      var succs = node.succs;
      for (var i = 0, j = succs.length; i < j; i++) {
        var s = succs[i];
        var p = pended[s.position];

        if (succ) {
          succ(node, s, v);
        }

        if (!p) {
          worklist.push(s);
          pended[s.position] = true;
        }
      }
    }
  }

  function detectBasicBlocks(bytecodes) {
    var code;
    var pc, end;

    assert(bytecodes);

    bytecodes[0].makeBlockHead();
    for (pc = 0, end = bytecodes.length; pc < end; pc++) {
      code = bytecodes[pc];
      switch (code.op) {
      case OP_lookupswitch:
        code.targets.forEach(function (target) {
          target.makeBlockHead();
        });
        break;

      case OP_jump:
      case OP_iflt:
      case OP_ifnlt:
      case OP_ifle:
      case OP_ifnlt:
      case OP_ifnle:
      case OP_ifgt:
      case OP_ifge:
      case OP_ifngt:
      case OP_ifeq:
      case OP_ifne:
      case OP_ifstricteq:
      case OP_ifstrictne:
      case OP_iftrue:
      case OP_iffalse:
        code.target.makeBlockHead();
        bytecodes[pc + 1].makeBlockHead();
        break;

      default:;
      }
    }

    var currentBlock = bytecodes[0];
    for (pc = 1, end = bytecodes.length; pc < end; pc++) {
      if (!bytecodes[pc].succs) {
        continue;
      }

      assert(currentBlock.succs);

      code = bytecodes[pc - 1];
      currentBlock.end = code;

      var nextBlock = bytecodes[pc];

      switch (code.op) {
      case OP_lookupswitch:
        code.targets.forEach(currentBlock.doubleLink.bind(currentBlock));
        break;

      case OP_jump:
        currentBlock.doubleLink(code.target);
        break;

      case OP_iflt:
      case OP_ifnlt:
      case OP_ifle:
      case OP_ifnlt:
      case OP_ifnle:
      case OP_ifgt:
      case OP_ifge:
      case OP_ifngt:
      case OP_ifeq:
      case OP_ifne:
      case OP_ifstricteq:
      case OP_ifstrictne:
      case OP_iftrue:
      case OP_iffalse:
        currentBlock.doubleLink(code.target);
        currentBlock.doubleLink(nextBlock);
        break;

      default:
        currentBlock.doubleLink(nextBlock);
      }

      currentBlock = nextBlock;
    }
  }

  /*
   * Calculate the dominance relation iteratively.
   *
   * Algorithm is from [1].
   *
   * [1] Cooper et al. "A Simple, Fast Dominance Algorithm"
   */
  function computeDominance(root) {
    var doms;

    function intersect(b1, b2) {
      var finger1 = b1;
      var finger2 = b2;
      while (finger1 !== finger2) {
        while (finger1 < finger2) {
          finger1 = doms[finger1];
        }
        while (finger2 < finger1) {
          finger2 = doms[finger2];
        }
      }
      return finger1;
    }

    /* The root must not have incoming edges! */
    assert(root.preds.length === 0);

    /*
     * For this algorithm we id blocks by their index in postorder. We will
     * change the id to the more familiar reverse postorder after we run the
     * algorithm.
     */
    var blocks = [];
    var block;
    dfs(root, null, blocks.push.bind(blocks), null);
    var n = blocks.length;
    for (var i = 0; i < n; i++) {
      block = blocks[i];
      block.blockId = i;
      block.frontier = new BytecodeSet();
    }

    doms = new Array(n);
    doms[n - 1] =  n - 1;
    var changed = true;

    while (changed) {
      changed = false;

      /* Iterate all blocks but the starting block in reverse postorder. */
      for (var b = n - 2; b >= 0; b--) {
        var preds = blocks[b].preds;
        var j = preds.length;

        var newIdom = preds[0].blockId;
        if (!doms[newIdom]) {
          for (var i = 1; i < j; i++) {
            newIdom = preds[i].blockId;
            if (doms[newIdom]) {
              break;
            }
          }
        }
        assert(doms[newIdom]);

        for (var i = 0; i < j; i++) {
          var p = preds[i].blockId;
          if (p === newIdom) {
            continue;
          }

          if (doms[p]) {
            newIdom = intersect(p, newIdom);
          }
        }

        if (doms[b] !== newIdom) {
          doms[b] = newIdom;
          changed = true;
        }
      }
    }

    for (var b = 0; b < n; b++) {
      block = blocks[b];

      /* Store the immediate dominator. */
      block.dominator = blocks[doms[b]];

      /* Compute the dominance frontier. */
      var preds = block.preds;
      if (preds.length >= 2) {
        for (var i = 0, j = preds.length; i < j; i++) {
          var runner = preds[i];
          while (runner !== block.dominator) {
            runner.frontier.add(block);
            runner = blocks[doms[runner.blockId]];
          }
        }
      }
    }

    /* Fix block id to be reverse postorder (program order). */
    for (var b = 0; b < n; b++) {
      block = blocks[b];
      block.blockId = n - 1 - block.blockId;
      block.frontier.takeSnapshot();
    }
  }

  function findNaturalLoops(root) {
    dfs(root,
        null,
        function post(v) {
          var succs = v.succs;
          for (var i = 0, j = succs.length; i < j; i++) {
            if (v.dom.has(succs[i])) {
              succs[i].makeLoopHead(v);
            }
          }
        },
        null);
  }

  function ExtractionContext() {
    /*
     * Because of labeled continues and and breaks we need to make a stack of
     * such targets. Note that |continueTargets.top() === exit|.
     */
    this.break = null;
    this.continue = null;
    this.loop = null;
    this.exit = null;
  }

  ExtractionContext.prototype.update = function update(props) {
    var desc = {};
    for (var p in props) {
      desc[p] = {
        value: props[p],
        writable: true,
        enumerable: true,
        configurable: true
      };
    }
    return Object.create(this, desc);
  };

  /*
   * Returns a new context updated with loop information if loop is inducible,
   * undefined otherwise.
   */
  function inducibleLoop(block, cx, parentLoops) {
    /* Natural loop information should already be computed. */
    if (!block.loop) {
      return undefined;
    }

    var loop = block.loop;
    var exits = new BytecodeSet();
    var loopBody = loop.snapshot;

    for (var i = 0, j = loopBody.length; i < j; i++) {
      exits.unionArray(loopBody[i].succs);
    }
    exits.difference(loop);
    exits.takeSnapshot();

    var exitNodes = exits.snapshot;
    if (parentLoops.length > 0) {
      for (var i = 0, j = exitNodes.length; i < j; i++) {
        var exit = exitNodes[i];
        for (var k = 0, l = parentLoops.length; k < l; k++) {
          if (exit.leadsTo(parentLoops[k].break) ||
              exit.leadsTo(parentLoops[k].continue)) {
            exits.remove(exit);
          }
        }
      }

      exits.takeSnapshot();
      exitNodes = exits.snapshot;
    }

    /* There should be a single exit node. */
    var mainExit;
    if (exits.size > 1) {
      for (var i = 0, j = exitNodes.length; i < j; i++) {
        mainExit = exitNodes[i];

        for (var k = 0, l = exitNodes.length; k < l; k++) {
          if (!exitNodes[k].leadsTo(mainExit)) {
            mainExit = null;
            break;
          }
        }

        if (mainExit) {
          break;
        }
      }
    } else {
      mainExit = exitNodes.top();
    }

    if (exits.size > 1 && !mainExit) {
      return undefined;
    }

    if (!mainExit && parentLoops.length > 0) {
      mainExit = parentLoops.top().exit;
    }

    return cx.update({ break: mainExit,
                       continue: block,
                       loop: loop,
                       exit: block });
  }

  /*
   * Returns the original context if trivial conditional, an updated context
   * if neither branch is trivial, undefined otherwise.
   */
  function inducibleIf(block, cx, info) {
    var succs = block.succs;

    if (succs.length !== 2) {
      return undefined;
    }

    var branch1 = succs[0];
    var branch2 = succs[1];
    var exit = cx.exit;
    info.negated = false;

    if (branch1.leadsTo(exit)) {
      info.thenBranch = branch2;
      info.negated = true;
      return cx;
    } else if (branch2.leadsTo(exit)) {
      info.thenBranch = branch1;
      return cx;
    }

    if (branch1.leadsTo(branch2)) {
      info.thenBranch = branch1;
      exit = branch2;
    } else if (branch2.leadsTo(branch1)) {
      info.thenBranch = branch2;
      info.negated = true;
      exit = branch1;
    } else {
      if (branch1.frontier.size > 1 || branch2.frontier.size > 1) {
        return undefined;
      }

      exit = branch1.frontier.choose();
      if (exit && branch2.frontier.choose() !== exit) {
        return undefined;
      }

      info.thenBranch = branch2;
      info.elseBranch = branch1;
      info.negated = true;
    }

    return cx.update({ exit: exit });
  }

  function inducibleSeq(block, cx) {
    if (block.succs.length > 1) {
      return false;
    }

    return true;
  }

  function induceControlTree(root) {
    var conts = [];
    var parentLoops = [];
    var cx = new ExtractionContext();
    var block = root;

    const K_LOOP_BODY = 0;
    const K_LOOP = 1;
    const K_IF_THEN = 2;
    const K_IF_ELSE = 3;
    const K_IF = 4;
    const K_SEQ = 5;

    var v;
    for (;;) {
      v = null;

out:  while (block !== cx.exit) {
        if (!block) {
          v = Control.Return;
          break;
        }

        if (block === cx.break) {
          v = Control.Break;
          break;
        }

        if (block === cx.continue && cx.continue !== cx.exit) {
          v = Control.Continue;
          break;
        }

        if (cx.loop && !cx.loop.has(block)) {
          for (var i = 0, j = parentLoops.length; i < j; i++) {
            var parentLoop = parentLoops[i];

            if (block === parentLoop.break) {
              v = new Control.LabeledBreak(parentLoop.break);
              break out;
            }

            if (block === parentLoop.continue) {
              v = new Control.LabeledContinue(parentLoop.exit);
              break out;
            }
          }
        }

        var info = {};
        if (cxx = inducibleLoop(block, cx, parentLoops)) {
          conts.push({ kind: K_LOOP_BODY,
                       next: cxx.break,
                       cx: cx });
          parentLoops.push(cxx);

          var succs = block.succs;
          if (succs === 1) {
            conts.push({ kind: K_SEQ,
                         block: block,
                         cx: cxx });
            block = succs[0];
          } else {
            var branch1 = succs[0];
            var branch2 = succs[1];
            if (branch1.leadsTo(cxx.break)) {
              conts.push({ kind: K_IF_THEN,
                           cond: block,
                           join: branch2,
                           joinCx: cxx,
                           cx: cxx });
              block = branch1;
            } else {
              conts.push({ kind: K_IF_THEN,
                           cond: block,
                           negated: true,
                           join: branch1,
                           joinCx: cxx,
                           cx: cxx });
              block = branch2;
            }
          }
          cx = cxx;
        } else if (cxx = inducibleIf(block, cx, info)) {
          conts.push({ kind: K_IF_THEN,
                       cond: block,
                       negated: info.negated,
                       else: info.elseBranch,
                       join: cxx.exit,
                       joinCx: cx,
                       cx: cxx });
          block = info.thenBranch;
          cx = cxx;
        } else if (inducibleSeq(block, cx)) {
          conts.push({ kind: K_SEQ,
                       block: block });
          block = block.succs.top();
        } else {
          v = new Control.Clusterfuck(block);
          break;
        }
      }

      var k;
out:  while (k = conts.pop()) {
        switch (k.kind) {
        case K_LOOP_BODY:
          block = k.next;
          cx = k.cx;
          conts.push({ kind: K_LOOP,
                       body: v });
          parentLoops.pop();
          break out;
        case K_LOOP:
          v = new Control.Loop(k.body, v);
          break;
        case K_IF_THEN:
          if (k.else) {
            block = k.else;
            cx = k.cx;
            conts.push({ kind: K_IF_ELSE,
                         cond: k.cond,
                         negated: k.negated,
                         then: v,
                         join: k.join,
                         cx: k.joinCx });
          } else {
            block = k.join;
            cx = k.joinCx;
            conts.push({ kind: K_IF,
                         cond: k.cond,
                         negated: k.negated,
                         then: v });
          }
          done = true;
          break out;
        case K_IF_ELSE:
          block = k.join;
          cx = k.cx;
          conts.push({ kind: K_IF,
                       cond: k.cond,
                       negated: k.negated,
                       then: k.then,
                       else: v });
          done = true;
          break out;
        case K_IF:
          v = new Control.If(k.cond, k.then, k.else, k.negated, v);
          break;
        case K_SEQ:
          v = new Control.Seq(k.block, v);
          break;
        default:
          unexpected();
        }
      }

      if (!block) {
        return v;
      }
    }
  }

  function Analysis(codeStream) {
    /*
     * Normalize the code stream. The other analyses are run by the user
     * on demand.
     */
    this.normalizeBytecode(new AbcStream(codeStream));
  }

  var Ap = Analysis.prototype;

  Ap.normalizeBytecode = function normalizeBytecode(codeStream) {
    /* This array is sparse, indexed by offset. */
    var bytecodesOffset = [];
    /* This array is dense. */
    var bytecodes = [];
    var code;

    while (codeStream.remaining() > 0) {
      var pos = codeStream.position;
      code = new Bytecode(codeStream);

      /* Get absolute offsets for normalization to new indices below. */
      switch (code.op) {
      case OP_nop:
      case OP_label:
        bytecodesOffset[pos] = bytecodes.length;
        continue;

      case OP_lookupswitch:
        code.targets = [];
        var offsets = code.offsets;
        for (var i = 0, j = offsets.length; i < j; i++) {
          offsets[i] += codeStream.position;
        }
        break;

      case OP_jump:
      case OP_iflt:
      case OP_ifnlt:
      case OP_ifle:
      case OP_ifnlt:
      case OP_ifnle:
      case OP_ifgt:
      case OP_ifge:
      case OP_ifngt:
      case OP_ifeq:
      case OP_ifne:
      case OP_ifstricteq:
      case OP_ifstrictne:
      case OP_iftrue:
      case OP_iffalse:
        code.offset += codeStream.position;
        break;

      default:;
      }

      /* Cache the position in the bytecode array. */
      code.position = bytecodes.length;
      bytecodesOffset[pos] = bytecodes.length;
      bytecodes.push(code);
    }

    for (var pc = 0, end = bytecodes.length; pc < end; pc++) {
      code = bytecodes[pc];
      switch (code.op) {
      case OP_lookupswitch:
        var offsets = code.offsets;
        for (var i = 0, j = offsets.length; i < j; i++) {
          code.targets.push(bytecodes[bytecodesOffset[offsets[i]]]);
        }
        code.offsets = undefined;
        break;

      case OP_jump:
      case OP_iflt:
      case OP_ifnlt:
      case OP_ifle:
      case OP_ifnlt:
      case OP_ifnle:
      case OP_ifgt:
      case OP_ifge:
      case OP_ifngt:
      case OP_ifeq:
      case OP_ifne:
      case OP_ifstricteq:
      case OP_ifstrictne:
      case OP_iftrue:
      case OP_iffalse:
        code.target = bytecodes[bytecodesOffset[code.offset]];
        code.offset = undefined;
        break;

      default:;
      }
    }

    this.bytecodes = bytecodes;
  };

  Ap.analyzeControlFlow = function analyzeControlFlow() {
    var bytecodes = this.bytecodes;
    assert(bytecodes);

    /*
     * There are some assumptions here that must be maintained if you want to
     * add new analyses:
     *
     * Anything after |computeDominance| should re-snapshot |.frontier| upon
     * mutation.
     *
     * Anything after |findNaturalLoops| should re-snapshot |.loop| upon
     * mutation.
     *
     * All extant analyses operate on the |.snapshot| array of the above sets.
     */

    detectBasicBlocks(bytecodes);
    var root = bytecodes[0];
    computeDominance(root);
    findNaturalLoops(root);
    this.controlTree = induceControlTree(root);
  }

  /*
   * Prints a normalized bytecode along with metainfo.
   */
  Ap.trace = function(writer) {
    function blockId(node) {
      return node.blockId;
    }

    writer.enter("analysis {");
    writer.enter("cfg {");

    var ranControlFlow = !!this.bytecodes[0].succs;

    for (var pc = 0, end = this.bytecodes.length; pc < end; pc++) {
      var code = this.bytecodes[pc];

      if (ranControlFlow && code.succs) {
        if (pc > 0) {
          writer.leave("}");
        }

        if (!code.dominator) {
          writer.enter("block unreachable {");
        } else {
          writer.enter("block " + code.blockId +
                       (code.succs.length > 0 ? " -> " +
                        code.succs.map(blockId).join(",") : "") + " {");

          writer.writeLn("idom".padRight(' ', 10) + code.dominator.blockId);
          writer.writeLn("frontier".padRight(' ', 10) + "{" + code.frontier.snapshot.map(blockId).join(",") + "}");
        }

        if (code.loop) {
          writer.writeLn("loop".padRight(' ', 10) + "{" + code.loop.snapshot.map(blockId).join(",") + "}");
        }

        writer.writeLn("");
      }

      writer.writeLn(("" + pc).padRight(' ', 5) + code);

      if (ranControlFlow && pc === end - 1) {
        writer.leave("}");
      }
    }

    writer.leave("}");

    if (this.controlTree) {
      writer.enter("control-tree {");
      var worklist = [this.controlTree];
      while (code = worklist.pop()) {
        code.trace(writer, worklist);
      }
      writer.leave("}");
    }

    writer.leave("}");
  };

  Ap.traceGraphViz = function traceGraphViz(writer, name, prefix) {
    prefix = prefix || "";
    if (!this.bytecodes) {
      return;
    }
    writeGraphViz(writer, name.toString(), this.bytecodes[0],
      function (n) {
        return prefix + n.blockId;
      },
      function (n) {
        return n.succs ? n.succs : [];
      }, function (n) {
        return n.preds ? n.preds : [];
      }, function (n) {
        return "Block: " + n.blockId;
      }
    );
  };

  return Analysis;

})();