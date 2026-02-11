import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

let camera, scene, renderer;
let controller;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let carModel = null;

init();
animate();

function init() {
    const container = document.createElement('div');
    document.getElementById('app').appendChild(container);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true; // Enable WebXR
    container.appendChild(renderer.domElement);

    // AR Button
    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] }));

    // Environment for realistic reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    // Controls (for non-AR mode)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', render); // use if there is no animation loop
    controls.minDistance = 2;
    controls.maxDistance = 10;
    controls.target.set(0, 0, -0.2);
    controls.update();

    // Load Model
    const loader = new GLTFLoader();
    loader.load('/Modelo/scene.gltf', function (gltf) {
        carModel = gltf.scene;

        // ADVANCED CLEANUP: Find the largest object (The Car) and hide everything else.
        let largestMesh = null;
        let maxVolume = 0;

        // 1. Calculate bounding boxes for all meshes to find the biggest one
        carModel.traverse((child) => {
            if (child.isMesh) {
                // Enable shadows while we are at it
                child.castShadow = true;
                child.receiveShadow = true;

                // Calculate volume
                const box = new THREE.Box3().setFromObject(child);
                const size = box.getSize(new THREE.Vector3());
                const volume = size.x * size.y * size.z;

                // Ignore huge flat planes (like floors) if any, but usually car is "fat"
                if (volume > maxVolume) {
                    maxVolume = volume;
                    largestMesh = child;
                }
            }
        });

        if (largestMesh) {
            console.log("Found largest mesh:", largestMesh.name);

            // 2. Hide everything
            carModel.traverse((child) => {
                if (child.isMesh) child.visible = false;
            });

            // 3. Show only the largest mesh and its children/parents if needed?
            // Actually, cars are often multiple meshes (wheels + body). 
            // We probably want to keep the "Group" that contains the largest mesh.

            // Let's try a different strategy: Hide only things that are WAY far from the largest mesh.
            largestMesh.visible = true;

            // Let's create a new clean group to hold ONLY the car parts.
            // But first, let's just focus on the car.

            // RE-STRATEGY: The car is likely a group of meshes. 
            // Let's calculate the bounding box of the largest mesh, and any mesh INSIDE that box (or close to it) is kept.
            // Everything else (far away text) is hidden.

            const carBox = new THREE.Box3().setFromObject(largestMesh);
            const carCenter = carBox.getCenter(new THREE.Vector3());

            carModel.traverse((child) => {
                if (child.isMesh) {
                    const childBox = new THREE.Box3().setFromObject(child);
                    const childCenter = childBox.getCenter(new THREE.Vector3());
                    const distance = childCenter.distanceTo(carCenter);

                    // If it's more than 10 meters away from the "main body", hide it.
                    if (distance > 10) {
                        child.visible = false;
                    } else {
                        child.visible = true;
                    }
                }
            });

            // 4. Center and Scale based on the CLEANED visible determination
            // We need a box that encapsulates only visible things
            const finalBox = new THREE.Box3();
            carModel.traverse((child) => {
                if (child.isMesh && child.visible) {
                    finalBox.expandByObject(child);
                }
            });

            const size = finalBox.getSize(new THREE.Vector3());
            const center = finalBox.getCenter(new THREE.Vector3());

            // Normalize scale to approx 4.5 meters
            const maxDim = Math.max(size.x, size.y, size.z);
            let scale = 4.5 / maxDim;
            if (!isFinite(scale)) scale = 1.0;

            carModel.scale.setScalar(scale);

            // Center model: We move the container (carModel) opposite to the center * scale
            // But since we are scaling the container, we just need to move the container.
            // Wait, scaling is applied to the children positions if we scale the group.
            // Let's position the group so the visual center is at 0,0,0

            // To do this simply: move the whole group
            carModel.position.x = -center.x * scale;
            carModel.position.y = -finalBox.min.y * scale;
            carModel.position.z = -center.z * scale;

        } else {
            console.warn("Could not find a large mesh, using default scaling.");
        }

        scene.add(carModel);

        // Add lights
        const dirLight = new THREE.DirectionalLight(0xffffff, 2);
        dirLight.position.set(5, 10, 7);
        dirLight.castShadow = true;
        scene.add(dirLight);

        render();
    });

    // AR Reticle (Visual guide for placement)
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial()
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // AR Interaction
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    window.addEventListener('resize', onWindowResize);
}

function onSelect() {
    if (reticle.visible && carModel) {
        // If reticle is active, move car to reticle position
        // We clone the model to place multiple or just move the single one?
        // Let's just move the single one for now to keep it simple
        carModel.position.setFromMatrixPosition(reticle.matrix);
        carModel.quaternion.setFromRotationMatrix(reticle.matrix);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    render();
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then(function (referenceSpace) {
                session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
                    hitTestSource = source;
                });
            });
            session.addEventListener('end', function () {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                reticle.visible = true;
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
            } else {
                reticle.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}
