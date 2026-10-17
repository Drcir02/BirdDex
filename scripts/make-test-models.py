"""Builds two tiny models for the automatic tests, so the model-speed code can be tested without
downloading BirdNET: tiny.onnx (small neural net) and tiny.tflite (one LOGISTIC operator).

Needs: pip install onnx numpy flatbuffers tflite ai-edge-litert
Run:   python scripts/make-test-models.py
"""
from pathlib import Path

import flatbuffers
import numpy as np
import onnx
import tflite as tfl
from onnx import TensorProto, helper, numpy_helper

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "models"
INPUT_SIZE = 1024


def make_onnx() -> None:
    rng = np.random.default_rng(7)
    w1 = numpy_helper.from_array(rng.normal(0, 0.05, (INPUT_SIZE, 64)).astype(np.float32), "w1")
    b1 = numpy_helper.from_array(np.zeros(64, np.float32), "b1")
    w2 = numpy_helper.from_array(rng.normal(0, 0.2, (64, 10)).astype(np.float32), "w2")
    b2 = numpy_helper.from_array(np.zeros(10, np.float32), "b2")
    graph = helper.make_graph(
        [
            helper.make_node("Gemm", ["input", "w1", "b1"], ["h1"]),
            helper.make_node("Relu", ["h1"], ["h2"]),
            helper.make_node("Gemm", ["h2", "w2", "b2"], ["h3"]),
            helper.make_node("Sigmoid", ["h3"], ["output"]),
        ],
        "tiny",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, INPUT_SIZE])],
        [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 10])],
        initializer=[w1, b1, w2, b2],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    onnx.save(model, OUT / "tiny.onnx")


def int_vector(builder: flatbuffers.Builder, start, values: list[int]) -> int:
    start(builder, len(values))
    for value in reversed(values):
        builder.PrependInt32(value)
    return builder.EndVector()


def offset_vector(builder: flatbuffers.Builder, start, offsets: list[int]) -> int:
    start(builder, len(offsets))
    for offset in reversed(offsets):
        builder.PrependUOffsetTRelative(offset)
    return builder.EndVector()


def make_tflite() -> None:
    """One LOGISTIC (sigmoid) operator, float32 [1, 1024] in and out. Built with the TFLite flatbuffer schema."""
    b = flatbuffers.Builder(1024)

    def tensor(name: str) -> int:
        name_offset = b.CreateString(name)
        shape = int_vector(b, tfl.TensorStartShapeVector, [1, INPUT_SIZE])
        tfl.TensorStart(b)
        tfl.TensorAddShape(b, shape)
        tfl.TensorAddType(b, tfl.TensorType.FLOAT32)
        tfl.TensorAddBuffer(b, 0)
        tfl.TensorAddName(b, name_offset)
        return tfl.TensorEnd(b)

    tensors = [tensor("input"), tensor("output")]

    tfl.OperatorCodeStart(b)
    tfl.OperatorCodeAddDeprecatedBuiltinCode(b, tfl.BuiltinOperator.LOGISTIC)
    tfl.OperatorCodeAddBuiltinCode(b, tfl.BuiltinOperator.LOGISTIC)
    tfl.OperatorCodeAddVersion(b, 1)
    op_code = tfl.OperatorCodeEnd(b)

    op_inputs = int_vector(b, tfl.OperatorStartInputsVector, [0])
    op_outputs = int_vector(b, tfl.OperatorStartOutputsVector, [1])
    tfl.OperatorStart(b)
    tfl.OperatorAddOpcodeIndex(b, 0)
    tfl.OperatorAddInputs(b, op_inputs)
    tfl.OperatorAddOutputs(b, op_outputs)
    operator = tfl.OperatorEnd(b)

    tensors_vec = offset_vector(b, tfl.SubGraphStartTensorsVector, tensors)
    graph_inputs = int_vector(b, tfl.SubGraphStartInputsVector, [0])
    graph_outputs = int_vector(b, tfl.SubGraphStartOutputsVector, [1])
    operators_vec = offset_vector(b, tfl.SubGraphStartOperatorsVector, [operator])
    graph_name = b.CreateString("main")
    tfl.SubGraphStart(b)
    tfl.SubGraphAddTensors(b, tensors_vec)
    tfl.SubGraphAddInputs(b, graph_inputs)
    tfl.SubGraphAddOutputs(b, graph_outputs)
    tfl.SubGraphAddOperators(b, operators_vec)
    tfl.SubGraphAddName(b, graph_name)
    subgraph = tfl.SubGraphEnd(b)

    tfl.BufferStart(b)
    empty_buffer = tfl.BufferEnd(b)

    codes_vec = offset_vector(b, tfl.ModelStartOperatorCodesVector, [op_code])
    subgraphs_vec = offset_vector(b, tfl.ModelStartSubgraphsVector, [subgraph])
    buffers_vec = offset_vector(b, tfl.ModelStartBuffersVector, [empty_buffer])
    description = b.CreateString("BirdDex tiny test model")
    tfl.ModelStart(b)
    tfl.ModelAddVersion(b, 3)
    tfl.ModelAddOperatorCodes(b, codes_vec)
    tfl.ModelAddSubgraphs(b, subgraphs_vec)
    tfl.ModelAddDescription(b, description)
    tfl.ModelAddBuffers(b, buffers_vec)
    model = tfl.ModelEnd(b)
    b.Finish(model, b"TFL3")
    (OUT / "tiny.tflite").write_bytes(bytes(b.Output()))


def check_tflite() -> None:
    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_path=str(OUT / "tiny.tflite"))
    interpreter.allocate_tensors()
    x = np.linspace(-4, 4, INPUT_SIZE, dtype=np.float32).reshape(1, INPUT_SIZE)
    interpreter.set_tensor(interpreter.get_input_details()[0]["index"], x)
    interpreter.invoke()
    y = interpreter.get_tensor(interpreter.get_output_details()[0]["index"])
    expected = 1 / (1 + np.exp(-x))
    assert np.allclose(y, expected, atol=1e-5), "tiny.tflite does not compute a sigmoid"
    print("tiny.tflite computes a sigmoid correctly")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    make_onnx()
    make_tflite()
    print("wrote", sorted(p.name for p in OUT.iterdir()))
    check_tflite()
