import { app } from "../../scripts/app.js";

/**
 * Any Switch Widget Extension
 * Dynamically manages inputs - adds/removes slots as needed
 */

const MIN_EMPTY_INPUTS = 1;
const INITIAL_INPUTS = 5;

function getConnectedType(node, direction = "input") {
  if (!node) return null;

  if (direction === "input") {
    // Check all input connections
    for (const input of node.inputs || []) {
      if (input.link != null) {
        const link = app.graph.links[input.link];
        if (link) {
          const originNode = app.graph.getNodeById(link.origin_id);
          if (originNode) {
            const originOutput = originNode.outputs[link.origin_slot];
            if (originOutput && originOutput.type !== "*") {
              return { type: originOutput.type, label: originOutput.name };
            }
            // Recursively check the origin node
            const upstreamType = getConnectedType(originNode, "output");
            if (upstreamType) return upstreamType;
          }
        }
      }
    }
  } else {
    // Check all output connections
    for (const output of node.outputs || []) {
      if (output.links && output.links.length > 0) {
        for (const linkId of output.links) {
          const link = app.graph.links[linkId];
          if (link) {
            const targetNode = app.graph.getNodeById(link.target_id);
            if (targetNode) {
              const targetInput = targetNode.inputs[link.target_slot];
              if (targetInput && targetInput.type !== "*") {
                return { type: targetInput.type, label: targetInput.name };
              }
              // Recursively check the target node
              const downstreamType = getConnectedType(targetNode, "input");
              if (downstreamType) return downstreamType;
            }
          }
        }
      }
    }
  }

  return null;
}

function removeUnusedInputsFromEnd(node, keepAtLeast = MIN_EMPTY_INPUTS) {
  if (!node.inputs) return;

  let lastConnectedIndex = -1;
  for (let i = 0; i < node.inputs.length; i++) {
    const input = node.inputs[i];
    if (input.name && input.name.startsWith("input_") && input.link != null) lastConnectedIndex = i;
  }

  const dataInputs = node.inputs.filter((inp) => inp.name && inp.name.startsWith("input_"));
  const connectedDataInputs = dataInputs.filter((inp) => inp.link != null);
  const targetDataInputCount = connectedDataInputs.length + keepAtLeast;

  // Remove excess inputs from the end (but never remove 'index')
  while (dataInputs.length > targetDataInputCount && dataInputs.length > INITIAL_INPUTS) {
    for (let i = node.inputs.length - 1; i >= 0; i--) {
      const input = node.inputs[i];
      if (input.name && input.name.startsWith("input_") && input.link == null) {
        node.removeInput(i);
        break;
      }
    }
    const newDataInputs = node.inputs.filter((inp) => inp.name && inp.name.startsWith("input_"));
    if (newDataInputs.length <= targetDataInputCount) break;
  }
}

function addAnyInputs(node, count = 1) {
  if (!node.inputs) node.inputs = [];

  for (let i = 0; i < count; i++) {
    const dataInputs = node.inputs.filter((inp) => inp.name !== "index");
    const inputNumber = dataInputs.length + 1;
    const inputName = `input_${String(inputNumber).padStart(2, "0")}`;
    node.addInput(inputName, node.nodeType || any_type || "*");
  }
}

/**
 * Stabilize the node - adjust inputs and update types
 */
function stabilizeNode(node) {
  if (!node.inputs) node.inputs = [];

  removeUnusedInputsFromEnd(node, MIN_EMPTY_INPUTS);
  const dataInputs = node.inputs.filter((inp) => inp.name && inp.name.startsWith("input_"));
  const lastDataInput = dataInputs[dataInputs.length - 1];
  if (!lastDataInput || lastDataInput.link != null) {
    addAnyInputs(node, 1);
  }
  let connectedType = getConnectedType(node, "input");
  if (!connectedType) {
    connectedType = getConnectedType(node, "output");
  }

  // Update node type (keep as "*" if not determined)
  const resolvedType = connectedType?.type || "*";
  node.nodeType = resolvedType;

  // Update data inputs to match the type, but keep 'index' input as INT
  for (const input of node.inputs)
    if (input.name === "index") input.type = "INT";
    else if (input.name && input.name.startsWith("input_")) input.type = node.nodeType;

  // Update all outputs to match the type
  for (const output of node.outputs) {
    output.type = node.nodeType;
    if (node.nodeType === "*") output.label = "*";
    else output.label = String(node.nodeType);
  }

  // Force graph update
  if (node.graph) {
    node.setDirtyCanvas(true, true);
    if (node.graph.change) node.graph.change();
  }
}

// Debounce helper
function debounce(func, wait = 64) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

app.registerExtension({
  name: "Steaked.AnySwitch",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name === "AnySwitch") {
      // Store the original onNodeCreated
      const onNodeCreated = nodeType.prototype.onNodeCreated;

      nodeType.prototype.onNodeCreated = function () {
        const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

        this.nodeType = "*";
        addAnyInputs(this, INITIAL_INPUTS);
        this.stabilizeBound = debounce(() => stabilizeNode(this), 64);
        const originalOnConnectionsChange = this.onConnectionsChange;
        this.onConnectionsChange = function (type, index, connected, link_info, input_info) {
          if (originalOnConnectionsChange) {
            originalOnConnectionsChange.apply(this, arguments);
          }
          this.stabilizeBound();
        };

        setTimeout(() => stabilizeNode(this), 100);

        return r;
      };

      // Override onConfigure to handle loaded workflows
      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function (data) {
        const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;

        if (!this.stabilizeBound) this.stabilizeBound = debounce(() => stabilizeNode(this), 64);
        setTimeout(() => stabilizeNode(this), 100);

        return r;
      };
    }
  },
});
