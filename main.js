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

    // Increase far plane to ensure we see everything
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true; // Enable WebXR
    container.appendChild(renderer.domElement);

    // AR Button with DOM Overlay (for touch gestures)
    document.body.appendChild(ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body }
    }));


    // Environment for realistic reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    scene.background = new THREE.Color(0xdddddd); // Light grey background

    // Controls (for non-AR mode)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', render); // use if there is no animation loop
    controls.minDistance = 0.1; // Allow closer zoom
    controls.maxDistance = 1000; // Allow farther zoom
    controls.target.set(0, 0, 0); // Default target
    controls.update();

    window.controls = controls; // Expose for loader to update target

    // Load Model
    const loader = new GLTFLoader();
    loader.load('/Modelo/scene.gltf', function (gltf) {
        carModel = gltf.scene;

        // Clean up model: Remove Text and loose geometry that might be clutter
        const toRemove = [];
        console.log("Starting model cleanup...");

        carModel.traverse((child) => {
            // Remove Text nodes
            if (child.name.match(/Text/i)) {
                toRemove.push(child);
                return;
            }

            // Heuristic: Remove objects that are "floating" too high
            if (child.position.y > 50 || child.position.y < -50) {
                toRemove.push(child);
                return;
            }

            // Enable shadows
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        console.log("Removing " + toRemove.length + " objects.");
        toRemove.forEach(child => {
            if (child.parent) child.parent.remove(child);
        });

        scene.add(carModel);

        // Auto-center and fit camera
        const box = new THREE.Box3().setFromObject(carModel);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        console.log("Model Size:", size);
        console.log("Model Center:", center);

        // If size is zero (empty model), warn
        if (size.lengthSq() === 0) {
            console.error("Model appears to be empty!");
        } else {
            // Fit camera to object (Make it close and personal!)
            const maxDim = Math.max(size.x, size.y, size.z);

            // Position camera at a nice 3/4 angle, slightly elevated
            const distance = maxDim * 1.2; // Much closer than before

            camera.position.set(
                center.x + distance * 0.8, // Offset X
                center.y + size.y * 0.8,   // Offset Y (slightly up)
                center.z + distance * 0.8  // Offset Z
            );

            camera.lookAt(center);

            // Update controls target
            if (window.controls) {
                window.controls.target.copy(center);
                window.controls.update();
            }
        }

        // Add lights
        // Add ambient light for general brightness
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

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

    // Touch Events for Scaling in AR (Pinch to Zoom)
    let initialDistance = 0;
    let initialScale = new THREE.Vector3();

    window.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2 && carModel) {
            const dx = e.touches[0].pageX - e.touches[1].pageX;
            const dy = e.touches[0].pageY - e.touches[1].pageY;
            initialDistance = Math.sqrt(dx * dx + dy * dy);
            initialScale.copy(carModel.scale);
        }
    });

    window.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && carModel && initialDistance > 0) {
            const dx = e.touches[0].pageX - e.touches[1].pageX;
            const dy = e.touches[0].pageY - e.touches[1].pageY;
            const currentDistance = Math.sqrt(dx * dx + dy * dy);

            const scaleFactor = currentDistance / initialDistance;

            // Apply scale (clamp to reasonable limits)
            const newScale = initialScale.clone().multiplyScalar(scaleFactor);
            // Limit scale between 0.1x (tiny) and 5x (huge) of original logic? 
            // Better to just clamp scalar to reasonable absolute values, but relative is easier.

            carModel.scale.copy(newScale);
        }
    });
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
