import { app } from "../../scripts/app.js";

const HIDDEN_KEY = "st_cooler_images";
const TEMP = "temp";

function revealEntries(output) {
    if (!output?.[HIDDEN_KEY]) return;
    output.images = output[HIDDEN_KEY];
    delete output[HIDDEN_KEY];
    for (const img of output.images) {
        if (img && !img.type) img.type = TEMP;
    }
}

async function copyWithoutMetadata(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function addCopyMenu(node) {
    const orig = node.getExtraMenuOptions;
    node.getExtraMenuOptions = function (_, options) {
        orig?.apply(this, arguments);
        const img = this.imgs?.filter((el) => el.naturalWidth > 0).at(-1);
        if (img) {
            options.unshift({
                content: "Copy image (no metadata)",
                callback: () => copyWithoutMetadata(img).catch(console.error),
            });
        }
    };
}

app.registerExtension({
    name: "Steaked.CoolerPreview",
    async setup() {
        const api = app.api ?? app.extensionManager?.api;
        const funnel = api?.dispatchCustomEvent;
        if (typeof funnel !== "function") return;
        api.dispatchCustomEvent = function (type, detail) {
            if (type === "executed") {
                const node = app.graph?.getNodeById?.(detail?.display_node ?? detail?.node);
                if (node?.type === "CoolerPreviewImage") {
                    revealEntries(detail?.output);
                }
            }
            return funnel.call(this, type, detail);
        };
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "CoolerPreviewImage") {
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = onConfigure?.apply(this, arguments);
                const entries = this.widgets_values?.images ?? this.widgets?.find((x) => x.name === "images")?.value;
                if (Array.isArray(entries)) {
                    for (const img of entries) {
                        if (img && !img.type) img.type = TEMP;
                    }
                }
                return r;
            };
        }
        addCopyMenu(nodeType.prototype);
    },
});
