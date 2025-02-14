#pragma once

#include <nan.h>
#include <node.h>
#include <v8.h>

namespace dd {

class PerIsolateData {
 private:
  Nan::Global<v8::Function> cpu_profiler_constructor;
  Nan::Global<v8::Function> location_constructor;
  Nan::Global<v8::Function> sample_constructor;

  PerIsolateData() {}

 public:
  static PerIsolateData* For(v8::Isolate* isolate);

  Nan::Global<v8::Function>& CpuProfilerConstructor();
  Nan::Global<v8::Function>& LocationConstructor();
  Nan::Global<v8::Function>& SampleConstructor();
};

} // namespace dd
