{ test } = require './test'

it "should throw an unrecognised operator error", ->
	test new Error("Unrecognised operator: 'foobar'"),
		resource: 'test'
		options:
			filter:
				$foobar: 'fails'