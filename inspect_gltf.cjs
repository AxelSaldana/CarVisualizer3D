
const fs = require('fs');
const gltfPath = 'e:/Markweb/CarVisualizerExample/public/Modelo/scene.gltf';

try {
    const data = fs.readFileSync(gltfPath, 'utf8');
    const json = JSON.parse(data);

    if (json.nodes) {
        console.log("Found " + json.nodes.length + " nodes.");
        json.nodes.forEach((node, index) => {
            if (node.name) {
                console.log(`Node ${index}: ${node.name}`);
            }
        });
    } else {
        console.log("No 'nodes' property found in JSON.");
    }
} catch (err) {
    console.error("Error reading or parsing GLTF:", err);
}
