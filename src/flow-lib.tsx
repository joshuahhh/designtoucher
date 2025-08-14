const opLayer = defineOp(
  // lol I guess I should do this just by drawing the second texture
  // on top of the first? but it's easier to just use a frag shader.
  // remember, this is all about drawing with transparency. no
  // forgetting about any alpha channels.
  class extends fragOp(
    2,
    `
      vec4 A = texture2D(tex2, uv);
      vec4 B = texture2D(tex1, uv);
      float outA = B.a + A.a * (1.0 - B.a);
      vec3 outRGB = (B.rgb * B.a + A.rgb * A.a * (1.0 - B.a)) / max(outA, 1e-6);
      gl_FragColor = vec4(outRGB, outA);
    `,
  ) {
    static id = "layer" as const;

    renderTop(props: TopProps) {
      return <OpLayer {...props} instance={this} />;
    }
  },
);

const OpLayer = ({ instance, phony, paramValues, paramValuesUP }: TopProps) => {
  return (
    <Sentence>
      Layer <SentenceHandle idx={0} phony={phony} /> over{" "}
      <SentenceHandle idx={1} phony={phony} />
    </Sentence>
  );
};
