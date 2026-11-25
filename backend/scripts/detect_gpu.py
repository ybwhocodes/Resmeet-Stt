#!/usr/bin/env python3
"""Scan hardware GPU name dynamically via Vulkan or OS device metadata."""
import ctypes
import ctypes.util
import shutil
import subprocess


def scan_vulkan_gpu():
    lib_path = ctypes.util.find_library("vulkan") or "libvulkan.so.1"
    try:
        vk = ctypes.CDLL(lib_path)
    except OSError:
        return None

    class VkApplicationInfo(ctypes.Structure):
        _fields_ = [
            ("sType", ctypes.c_int),
            ("pNext", ctypes.c_void_p),
            ("pApplicationName", ctypes.c_char_p),
            ("applicationVersion", ctypes.c_uint32),
            ("pEngineName", ctypes.c_char_p),
            ("engineVersion", ctypes.c_uint32),
            ("apiVersion", ctypes.c_uint32),
        ]

    class VkInstanceCreateInfo(ctypes.Structure):
        _fields_ = [
            ("sType", ctypes.c_int),
            ("pNext", ctypes.c_void_p),
            ("flags", ctypes.c_uint32),
            ("pApplicationInfo", ctypes.POINTER(VkApplicationInfo)),
            ("enabledLayerCount", ctypes.c_uint32),
            ("ppEnabledLayerNames", ctypes.POINTER(ctypes.c_char_p)),
            ("enabledExtensionCount", ctypes.c_uint32),
            ("ppEnabledExtensionNames", ctypes.POINTER(ctypes.c_char_p)),
        ]

    class VkPhysicalDeviceProperties(ctypes.Structure):
        _fields_ = [
            ("apiVersion", ctypes.c_uint32),
            ("driverVersion", ctypes.c_uint32),
            ("vendorID", ctypes.c_uint32),
            ("deviceID", ctypes.c_uint32),
            ("deviceType", ctypes.c_int),
            ("deviceName", ctypes.c_char * 256),
            ("pipelineCacheUUID", ctypes.c_uint8 * 16),
            ("raw", ctypes.c_uint8 * 1024),
        ]

    app_info = VkApplicationInfo(1, None, b"resmeet", 1, b"resmeet", 1, (1 << 22))
    create_info = VkInstanceCreateInfo(1, None, 0, ctypes.pointer(app_info), 0, None, 0, None)
    instance = ctypes.c_void_p()

    if vk.vkCreateInstance(ctypes.byref(create_info), None, ctypes.byref(instance)) != 0:
        return None

    try:
        count = ctypes.c_uint32(0)
        vk.vkEnumeratePhysicalDevices(instance, ctypes.byref(count), None)
        if count.value == 0:
            return None

        devs = (ctypes.c_void_p * count.value)()
        vk.vkEnumeratePhysicalDevices(instance, ctypes.byref(count), devs)

        # Priority: 2 = Discrete GPU, 1 = Integrated GPU, 3 = Virtual GPU (skip 4 = CPU llvmpipe)
        priority = {2: 0, 1: 1, 3: 2}
        candidates = []
        for dev in devs:
            props = VkPhysicalDeviceProperties()
            vk.vkGetPhysicalDeviceProperties(dev, ctypes.byref(props))
            name = props.deviceName.decode("utf-8", "ignore").strip()
            if not name or props.deviceType == 4 or "llvmpipe" in name.lower() or "swiftshader" in name.lower():
                continue
            candidates.append((priority.get(props.deviceType, 9), name))

        if candidates:
            candidates.sort(key=lambda item: item[0])
            return candidates[0][1]
    finally:
        vk.vkDestroyInstance(instance, None)

    return None


def scan_nvidia_smi():
    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            stderr=subprocess.DEVNULL,
            timeout=2,
            text=True,
        )
        first = out.strip().splitlines()[0].strip() if out.strip() else ""
        return first or None
    except Exception:
        return None


if __name__ == "__main__":
    gpu = scan_vulkan_gpu() or scan_nvidia_smi()
    if gpu:
        print(gpu)
